import Link from "next/link";

/** Uses the researcher's supplied artwork, not a generated replacement mark. */
export function GenithmBrand({ href = "/dashboard/ai" }: { href?: string }) {
  return <Link className="genithm-brand" href={href} aria-label="Genithm home">
    <img src="/genithm-logo.webp" width={46} height={46} alt="" />
    <span>Genithm</span>
  </Link>;
}
