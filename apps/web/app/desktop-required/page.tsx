import Link from "next/link";
import { GenithmBrand } from "@/components/genithm-brand";

export const metadata = { title: "Desktop required | Genithm" };

export default function DesktopRequiredPage() {
  return <main style={{maxWidth:640,margin:"64px auto",padding:"28px 24px",color:"var(--g-ink)"}}>
    <GenithmBrand />
    <h1 style={{marginTop:28,fontSize:30,lineHeight:1.25}}>Open Genithm on a desktop or laptop</h1>
    <p style={{fontSize:16,lineHeight:1.8,color:"var(--g-muted)"}}>
      Genithm is a desktop bioinformatics research workspace. Phones and tablets
      are not supported for signing in or running analyses.
    </p>
    <p style={{fontSize:16,lineHeight:1.8}}>
      Use your computer to work with research files, scientific pipelines,
      comparisons and results. Your saved research remains in your account.
    </p>
    <Link href="/" style={{display:"inline-block",marginTop:18,color:"var(--g-blue)"}}>About Genithm</Link>
  </main>;
}
