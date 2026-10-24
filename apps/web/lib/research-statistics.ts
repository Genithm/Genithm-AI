/** Numeric methods for Genithm's bounded browser-local exploratory analyses.
 * Implementations are deterministic; no network, RNG, or external analysis service.
 */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  if (pValues.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("P-values must be finite and in [0, 1].");
  const count = pValues.length;
  const ordered = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const adjusted = new Array<number>(count);
  let previous = 1;
  for (let rank = count; rank >= 1; rank--) {
    const entry = ordered[rank - 1];
    previous = Math.min(previous, (entry.p * count) / rank, 1);
    adjusted[entry.i] = previous;
  }
  return adjusted;
}

/** Lanczos gamma approximation with reflection. Valid for positive real inputs. */
export function logGamma(z: number): number {
  if (!Number.isFinite(z) || z <= 0) throw new Error("Gamma domain error.");
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < c.length; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
}

function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 2e-14) return h;
  }
  throw new Error("Incomplete beta did not converge.");
}
export function regularizedBeta(x: number, a: number, b: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b) || x < 0 || x > 1 || a <= 0 || b <= 0)
    throw new Error("Invalid incomplete beta arguments.");
  if (x === 0) return 0;
  if (x === 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return Math.max(0, Math.min(1, x < (a + 1) / (a + b + 2)
    ? front * betaFraction(a, b, x) / a
    : 1 - front * betaFraction(b, a, 1 - x) / b));
}
/** Two-sided Student t survival probability. */
export function studentTTwoSidedP(t: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 0)
    throw new Error("Invalid Student t parameters.");
  const x = degreesOfFreedom / (degreesOfFreedom + t * t);
  return Math.max(1e-300, regularizedBeta(x, degreesOfFreedom / 2, .5));
}
export function medianSorted(values: number[]): number {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error("Median requires finite numbers.");
  values.sort((a, b) => a - b);
  const i = Math.floor(values.length / 2);
  return values.length % 2 ? values[i] : (values[i - 1] + values[i]) / 2;
}

export function safeTsv(value: string): string {
  const withoutControls = value.replace(/[\t\r\n\0]/g, " ").slice(0, 255);
  return /^[\s]*[=+@\-]/.test(withoutControls) ? "'" + withoutControls : withoutControls;
}
