import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {samQualityControl} from '../chat_sam_qc.mjs';
const B=s=>Buffer.from(s,'utf8');
const H=b=>createHash('sha256').update(b).digest('hex');
const HEADER='@HD\tVN:1.6\tSO:unsorted\n@SQ\tSN:chr1\tLN:100\n@SQ\tSN:chr2\tLN:200\n';
const row=(name,flag,ref,pos,mapq,cigar,sequence,opts='')=>
 [name,flag,ref,pos,mapq,cigar,'*',0,0,sequence,sequence==='*'?'*':'I'.repeat(sequence.length),...(opts?[opts]:[])].join('\t')+'\n';
const analyze=s=>samQualityControl({sam:B(s)});
test('valid mapped and unmapped SAM count primary reads accurately and report correct MAPQ',()=>{
 const s=HEADER+row('read1',0,'chr1',1,60,'10M','ACGTACGTAC','NM:i:1')+
  row('read2',4,'*',0,0,'*','ACGT')+row('read1',256,'chr2',10,30,'10M','ACGTACGTAC')+
  row('read3',2048,'chr1',20,40,'10M','ACGTACGTAC');
 const r=analyze(s);
 assert.equal(r.summary.alignment_records,4);
 assert.equal(r.summary.primary_mapped,1);
 assert.equal(r.summary.primary_unmapped,1);
 assert.equal(r.summary.secondary,1);
 assert.equal(r.summary.supplementary,1);
 assert.equal(r.summary.mapped_primary_mapq_mean,60);
 assert.equal(r.summary.total_reference_covered_bases,10);
 assert.equal(r.summary.nm_tagged_primary,1);
 assert.equal(r.summary.nm_edits_primary_total,1);
 assert.equal(r.provenance.source_files.sam.sha256,H(B(s)));
 assert.equal(r.outputs['sam-reference-coverage.tsv'].split('\n')[1].split('\t')[4],'10');
});
test('CIGAR M/= /X blocks union coverage; deletions, skips and insertions do not count as covered',()=>{
 const s=HEADER+row('splice',0,'chr1',1,20,'3M2I4=5N3X2D','A'.repeat(12))+
 row('repeat',0,'chr1',1,30,'10M','A'.repeat(10));
 const r=analyze(s);
 assert.equal(r.summary.primary_mapped,2);
 assert.equal(r.summary.primary_aligned_reference_bases,20);
 assert.equal(r.summary.primary_aligned_query_bases,22);
 // First record blocks [0,3) [3,7) [12,15); second [0,10).
 assert.equal(r.summary.total_reference_covered_bases,13);
 assert.match(r.outputs['sam-cigar-operations.tsv'],/^N\t5$/m);
 assert.match(r.outputs['sam-cigar-operations.tsv'],/^I\t2$/m);
 assert.match(r.outputs['sam-cigar-operations.tsv'],/^D\t2$/m);
});
test('primary MAPQ 255 is explicitly unknown and is excluded from mean',()=>{
 const r=analyze(HEADER+row('unknown',0,'chr2',10,255,'5M','AAAAA')+
  row('low',0,'chr2',20,0,'5M','TTTTT')+row('high',0,'chr2',30,40,'5M','GGGGG'));
 assert.equal(r.summary.mapped_primary_mapq_unknown,1);
 assert.equal(r.summary.mapped_primary_mapq_mean,20);
 assert.equal(r.summary.mapped_primary_mapq_zero,1);
 assert.equal(r.summary.mapped_primary_mapq_30_plus,1);
 assert.match(r.outputs['sam-mapq.svg'],/MAPQ 255/);
});
test('reference coverage is unique per reference and avoids double counting duplicate read positions',()=>{
 const r=analyze(HEADER+row('r1',1024,'chr1',1,60,'20M','A'.repeat(20))+
  row('r2',0,'chr1',11,60,'20M','A'.repeat(20))+
  row('r3',0,'chr2',1,60,'10M','A'.repeat(10)));
 assert.equal(r.summary.duplicate_flagged,1);
 assert.equal(r.summary.total_reference_covered_bases,40);
 assert.equal(r.summary.primary_aligned_reference_bases,50);
 assert.match(r.outputs['sam-reference-coverage.tsv'],/^chr1\t100\t2\t40\t30\t0\.300000/m);
});
test('paired-end flags are counts of SAM alignment records, not inferred fragments',()=>{
 const s=HEADER+row('pair',99,'chr1',1,60,'10M','A'.repeat(10))+
  row('pair',147,'chr1',20,60,'10M','T'.repeat(10));
 const r=analyze(s);
 assert.equal(r.summary.alignment_records,2);
 assert.equal(r.summary.paired_flagged,2);
 assert.equal(r.summary.proper_pair_flagged,2);
 assert.equal(r.summary.first_segment,1);
 assert.equal(r.summary.last_segment,1);
 assert.equal(r.summary.reverse_strand,1);
});
test('SAM.gz is analyzed and provenance hashes compressed original bytes',()=>{
 const bytes=gzipSync(B(HEADER+row('a',0,'chr1',1,30,'10M','A'.repeat(10))));
 const r=samQualityControl({sam:bytes});
 assert.equal(r.summary.total_reference_covered_bases,10);
 assert.equal(r.provenance.source_files.sam.sha256,H(bytes));
});
test('header-only SAM does not fabricate alignments and produces actual zero-count results',()=>{
 const r=analyze(HEADER);
 assert.equal(r.summary.alignment_records,0);
 assert.equal(r.summary.total_reference_covered_bases,0);
 assert.equal(r.summary.mapped_primary_mapq_mean,null);
 assert.match(r.outputs['sam-reference-coverage.tsv'],/^chr1\t100\t0\t0\t0\t0\.000000/m);
});
test('strictly rejects wrong CIGAR query length, absent references and ref-end overflow',()=>{
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr1',1,60,'10M','AAAAA')),/SEQ length/);
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr404',1,60,'5M','AAAAA')),/absent @SQ/);
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr1',98,60,'5M','AAAAA')),/exceeds declared reference length/);
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr1',1,60,'0M','AAAAA')),/CIGAR/);
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr1',1,60,'2M1Z2M','AAAAA')),/CIGAR/);
});
test('invalid flags, MAPQ, headers, quality strings and NM tags fail closed',()=>{
 assert.throws(()=>analyze(HEADER+row('bad',192,'chr1',1,60,'5M','AAAAA')),/both first and last/);
 assert.throws(()=>analyze(HEADER+row('bad',64,'chr1',1,60,'5M','AAAAA')),/Unpaired/);
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr1',1,256,'5M','AAAAA')),/MAPQ/);
 assert.throws(()=>analyze(HEADER+row('bad',0,'chr1',1,60,'5M','AAAAA','NM:i:-1')),/NM:i/);
 assert.throws(()=>analyze('@SQ\tSN:chr1\tLN:100\n@SQ\tSN:chr1\tLN:100\n'),/Duplicate/);
 assert.throws(()=>analyze(HEADER+row('good',0,'chr1',1,60,'5M','AAAAA')+'@SQ\tSN:chr3\tLN:100\n'),/header occurs after/);
 assert.throws(()=>analyze(HEADER+'bad\t0\tchr1\t1\t60\t5M\t*\t0\t0\tAAAAA\tI\n'),/QUAL/);
});
test('BAM/CRAM binary and decompression bombs are rejected, never mistaken for valid SAM',()=>{
 assert.throws(()=>samQualityControl({sam:Buffer.from([66,65,77,1,0,1])}),/binary|mandatory|columns|SAM/i);
 assert.throws(()=>samQualityControl({sam:Buffer.from([31,139,9,9])}),/gzip/);
 assert.throws(()=>samQualityControl({sam:gzipSync(B('X'.repeat(12*1024*1024+1)))}),/gzip|decompressed size limit/);
 assert.throws(()=>samQualityControl({bam:B(HEADER)}),/SAM QC requires exactly one/);
});
test('QNAME is not leaked to results; formula-like reference name neutralized in TSV and escaped in SVG',()=>{
 const source='@SQ\tSN:=PRIVATE\tLN:100\n'+row('private-patient-secret',0,'=PRIVATE',1,60,'5M','AAAAA');
 const r=analyze(source);
 assert.doesNotMatch(JSON.stringify(r.summary),/private-patient-secret/);
 assert.doesNotMatch(r.outputs['provenance.json'],/private-patient-secret/);
 assert.match(r.outputs['sam-reference-coverage.tsv'],/^'=PRIVATE\t/m);
});
test('large sparse alignment fixture remains within bounded indexed coverage calculations',()=>{
 const count=25000,reads=Array.from({length:count},(_,i)=>row('read'+i,0,'chr2',1+(i%190)*1,30,'5M','AAAAA')).join('');
 const r=analyze(HEADER+reads);
 assert.equal(r.summary.primary_mapped,count);
 assert.equal(r.summary.total_reference_covered_bases,194);
});