"""Real complete streaming VCF site-QC metrics, malformed inputs, and memory guards."""
from __future__ import annotations
import io
import gzip
import hashlib
from uuid import uuid4
import pytest
from app.large_data.policy import LargeDataError
from app.large_data.vcf_scanner import scan_vcf, validate_vcf_metric
from app.large_data.verify import verify_stream
from app.large_data.file_intake import file_report, validate_intake
from app.large_data.quality_report import seal_report, report_for_row, report_tsv
from app.large_data.file_registry import describe, LEGACY_VERSION, VERSION

HEADER = (b'##fileformat=VCFv4.3\n##reference=private-assembly\n'
          b'#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n')

def site(pos, ref, alt, qual='50', filt='PASS', chrom='chr1'):
    return f'{chrom}\t{pos}\tprivate-id\t{ref}\t{alt}\t{qual}\t{filt}\tDP=20\n'.encode()

def synthetic():
    return HEADER + b''.join([
      site(1,'A','G'),site(2,'C','A',qual='.',filt='.'),site(3,'A','G,T'),
      site(4,'AC','GT'),site(5,'A','AT'),site(6,'C','<DEL>',qual='25',filt='lowQual'),
      site(7,'A','.'),site(8,'A','A'),site(9,'A','A[chr2:20['),
    ])

def row(data, filename='study.vcf', mode='auto'):
    return dict(id=str(uuid4()),project_id=str(uuid4()),data_format='opaque',expected_bytes=len(data),
      checked_bytes=len(data),expected_sha256=hashlib.sha256(data).hexdigest(),
      actual_sha256=hashlib.sha256(data).hexdigest(),original_filename=filename,
      intake_mode=mode,state='ready',relative_path=filename,batch_id=None)

def result(data, filename='study.vcf', mode='auto', limit=1000000):
    item=row(data,filename,mode)
    _, report = verify_stream(io.BytesIO(data), item, limit)
    item['summary']=report
    return item, report

def test_actual_all_categories_full_statistics_and_no_source_leak():
    item,report=result(synthetic())
    assert report['scientific_scope']=='full_vcf_site_qc'
    m=report['metrics']
    assert (m['record_count'],m['snv_sites'],m['mnv_sites'],m['indel_sites'],m['complex_sites'],
            m['symbolic_sites'],m['reference_only_sites'])==(9,3,1,1,1,2,1)
    assert m['canonical_snv_alt_alleles']==4
    assert (m['transitions'],m['transversions'])==(2,2)
    assert m['multiallelic_sites']==1
    assert (m['pass_sites'],m['failed_filter_sites'],m['unfiltered_sites'])==(7,1,1)
    assert m['quality_available_sites']==8 and m['missing_quality_sites']==1
    assert m['sample_count']==0 and m['contigs_seen']==1
    assert m['sampling'] is False and m['genotypes_inspected'] is False
    assert item['summary']['intake']['inspection']=='complete_vcf'
    assert item['summary']['intake']['registry_version']==VERSION
    assert b'private-id' not in str(report).encode()
    assert b'private-assembly' not in str(report).encode()
    assert file_report(item)['report']['metrics']==m
    assert report_for_row(item)['report']['metrics']==m
    tsv=report_tsv(report_for_row(item))
    assert 'canonical_snv_alt_alleles\t4' in tsv
    assert 'private-id' not in tsv

@pytest.mark.parametrize('suffix', ['vcf', 'vcf.gz', 'g.vcf', 'g.vcf.gz'])
def test_auto_vcf_formats_and_metadata(suffix):
    data=synthetic()
    stored=gzip.compress(data) if suffix.endswith('.gz') else data
    item,report=result(stored,'tumor.'+suffix)
    assert report['metrics']['record_count']==9
    assert report['metrics']['expanded_bytes']==len(data)
    assert item['summary']['source_sha256']==hashlib.sha256(stored).hexdigest()


def test_legacy_vcf_hash_only_and_preserve_mode_are_unchanged():
    data=synthetic()
    item,reported=result(data,'archive.vcf',mode='preserve')
    assert reported['metrics'] is None and reported['scientific_scope']=='bytes_only'
    assert reported['intake']['inspection']=='integrity_only'
    old=reported.copy();old['intake']=dict(reported['intake'])
    old['intake']['registry_version']=LEGACY_VERSION
    old['intake']['name_hint']=describe('archive.vcf', registry_version=LEGACY_VERSION)
    old.pop('report_sha256')
    item['intake_mode']='auto'
    old['intake']['mode']='auto';old['intake']['warnings']=[]
    item['summary']=seal_report(old)
    assert file_report(item)['report']['intake']['inspection']=='integrity_only'
    assert item['summary']['intake']['name_hint']['available_inspection']=='integrity_only'


def test_genotype_rows_accepted_but_never_exported_or_inferred():
    data=b'##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tprivate-sample\n'+\
      b'chr9\t1\tsecret123\tG\tA\t.\tPASS\t.\tGT:DP\t0/1:10\n'
    item,rep=result(data)
    assert rep['metrics']['sample_count']==1 and rep['metrics']['missing_quality_sites']==1
    assert rep['metrics']['genotypes_inspected'] is False
    assert 'private-sample' not in str(rep) and 'secret123' not in str(rep)
    assert file_report(item)['report']['metrics']['record_count']==1

@pytest.mark.parametrize('bad',[
    b'', b'garbage\n',HEADER.replace(b'VCFv4.3',b'VCFv5.0'),HEADER.replace(b'INFO',b'INFO\t'),
    HEADER + b'chr1\tX\tid\tA\tG\t20\tPASS\t.\n',
    HEADER + b'chr1\t1\tid\tA\t?\t20\tPASS\t.\n',
    HEADER + b'chr1\t1\tid\tA\tG\tNaN\tPASS\t.\n',
    HEADER + b'chr1\t1\tid\tA\tG\t10\tPASS;lowQual\t.\n',
    HEADER + b'chr1\t1\tid\tA\tG\t10\tPASS\n',
    HEADER + b'chr1\t1\tid\tA\tG\t10\tPASS\t.\tEXTRA\n',
    HEADER + b'#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n',
    b'##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tINFO\tFILTER\n',
    b'##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tX\tX\n',
    HEADER + b'chr1\t1\tid\tA\tG\t20\tPASS\t.\x00\n',
])
def test_fail_closed_invalid_syntax(bad):
    with pytest.raises(LargeDataError,match='format_invalid'):
        scan_vcf(io.BytesIO(bad), 100000)


def test_decompression_budget_line_budget_and_gzip_corruption():
    data=synthetic()
    with pytest.raises(LargeDataError,match='resource_limit'):
        result(gzip.compress(data),'sample.vcf.gz',limit=100)
    with pytest.raises(LargeDataError,match='format_invalid'):
        result(gzip.compress(data)[:-3],'sample.vcf.gz')
    oversized=HEADER+site(1,'A','G')[:-1]+b'\t'+b'A'*((16<<20)+3)+b'\n'
    with pytest.raises(LargeDataError,match='resource_limit'):
        scan_vcf(io.BytesIO(oversized),len(oversized)+100)


def test_profile_tamper_is_rejected_even_when_attacker_reseals_checksum():
    item,rep=result(synthetic())
    changed=dict(rep);changed['metrics']=dict(rep['metrics']);changed['metrics']['transitions']=999
    changed.pop('report_sha256');item['summary']=seal_report(changed)
    with pytest.raises(LargeDataError,match='integrity_failed'):
        file_report(item)


def test_bounded_iteration_through_many_records_without_read_all():
    class NoReadAll(io.BytesIO):
        def read(self,n=-1):
            assert n!=-1,"streaming scanner must never read whole input"
            return super().read(n)
    data=HEADER+site(1,'A','G')*10000
    m=scan_vcf(NoReadAll(data),len(data))
    assert m['record_count']==10000 and m['transitions']==10000
    assert m['expanded_bytes']==len(data)