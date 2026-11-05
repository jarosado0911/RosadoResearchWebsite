// Hodgkin-Huxley (Traub-Miles rates, V_T = -55 mV) on the CA1 graph with NeuroVISOR-CSharpStudies' SBDF2 solver,
// stimulated the way a touch in Neuro-VISOR does it: a Dirichlet clamp of one node at +50 mV for a short time, or,
// given iinj_nA, like an electrode: a current step into that node (the clamp would pin the soma and hide its own spike).
// Writes <out>/meta.txt and <out>/v.f32 (float32 [frame][node] membrane potential in volts, every recEvery steps).
//
// usage: hh_harness <graph.txt> <outDir> [tEnd_s=0.025] [dt_s=2e-5] [recEvery=5] [clampStart_s=0.0005] [clampLen_s=0.001] [stimNode] [iinj_nA]
using System.Globalization;
using NeuronCSharpStudy;

var inv = CultureInfo.InvariantCulture;
string graph = args[0], outDir = args[1];
double tEnd = args.Length > 2 ? double.Parse(args[2], inv) : 0.025;
double dt = args.Length > 3 ? double.Parse(args[3], inv) : 2e-5;
int recEvery = args.Length > 4 ? int.Parse(args[4]) : 5;
double clampStart = args.Length > 5 ? double.Parse(args[5], inv) : 0.0005;
double clampLen = args.Length > 6 ? double.Parse(args[6], inv) : 0.001;
double iinj = args.Length > 8 ? double.Parse(args[8], inv) * 1e-9 : 0.0;   // [A]; 0: the voltage clamp
Directory.CreateDirectory(outDir);

// the graph: "n ne nsoma", n lines "x y z r" [um], ne lines "u v length", soma ids
var lines = File.ReadAllLines(graph);
var hd = lines[0].Split(' ').Select(int.Parse).ToArray();
int n = hd[0], ne = hd[1];
var nodes = new List<SwcNode>(n);
for (int i = 0; i < n; i++)
{
    var p = lines[1 + i].Split(' ').Select(s => double.Parse(s, inv)).ToArray();
    nodes.Add(new SwcNode { X = p[0], Y = p[1], Z = p[2], RadiusMicrons = p[3] });
}
for (int e = 0; e < ne; e++)
{
    var p = lines[1 + n + e].Split(' ');
    int u = int.Parse(p[0]), w = int.Parse(p[1]); double l = double.Parse(p[2], inv);
    nodes[u].AdjacencyMicrons[w] = l; nodes[w].AdjacencyMicrons[u] = l;
}
int soma = int.Parse(lines[1 + n + ne].Split(' ', StringSplitOptions.RemoveEmptyEntries)[0]);

// the stimulus: the dendrite tip farthest (along the cell) from the soma, as if a user touched the end of the tuft
var dist = Enumerable.Repeat(double.PositiveInfinity, n).ToArray();
dist[soma] = 0; var q = new Queue<int>(); q.Enqueue(soma);
while (q.Count > 0) { int u = q.Dequeue(); foreach (var (w, l) in nodes[u].AdjacencyMicrons) if (double.IsInfinity(dist[w])) { dist[w] = dist[u] + l; q.Enqueue(w); } }
int stim = args.Length > 7 ? int.Parse(args[7])     // a chosen node, or by default:
    : Enumerable.Range(0, n).Where(i => nodes[i].AdjacencyMicrons.Count == 1).OrderByDescending(i => dist[i]).First();
Console.WriteLine($"{n} nodes, soma {soma}, stimulus node {stim} ({dist[stim]:F0} um from the soma)");

var solver = new Sbdf2Solver(nodes) { HalfEdgeMembraneLength = true };
solver.BuildAndFactor(dt, ClampStrategy.Rank1, stim);
solver.FactorStartup(dt);
// the injected current as a rate of change of V at the stimulus node [V/s]: I / (C_m * its membrane area)
double iDensity = iinj / (solver.Cap * 2.0 * Math.PI * nodes[stim].RadiusMicrons * 1e-6 * solver.MembraneLength(stim));

var v0 = new double[n]; Array.Fill(v0, SimParams.VStart);
double[] v = (double[])v0.Clone(), vPre = (double[])v0.Clone(), vNew = new double[n];
double[] ng = Fill(SimParams.NInit), mg = Fill(SimParams.MInit), hg = Fill(SimParams.HInit);
double[] nPre = (double[])ng.Clone(), mPre = (double[])mg.Clone(), hPre = (double[])hg.Clone();
double[] nNew = new double[n], mNew = new double[n], hNew = new double[n];
double[] f = new double[n], fPre = new double[n];
double[] fn = new double[n], fnP = new double[n], fm = new double[n], fmP = new double[n], fh = new double[n], fhP = new double[n];

int steps = (int)Math.Round(tEnd / dt), frames = 0;
using var bw = new BinaryWriter(File.Create(Path.Combine(outDir, "v.f32")));
var sw = System.Diagnostics.Stopwatch.StartNew();
double firstSomaSpike = double.NaN;
for (int s = 0; s <= steps; s++)
{
    double t = s * dt;
    if (s % recEvery == 0) { foreach (var x in v) bw.Write((float)x); frames++; }
    if (double.IsNaN(firstSomaSpike) && v[soma] > 0) firstSomaSpike = t;
    if (s == steps) break;

    solver.ReactF(v, ng, mg, hg, f);
    solver.ReactF(vPre, nPre, mPre, hPre, fPre);
    for (int j = 0; j < n; j++)
    {
        Gate(Sbdf2Solver.AlphaN, Sbdf2Solver.BetaN, v[j], vPre[j], ng[j], nPre[j], out fn[j], out fnP[j]);
        Gate(Sbdf2Solver.AlphaM, Sbdf2Solver.BetaM, v[j], vPre[j], mg[j], mPre[j], out fm[j], out fmP[j]);
        Gate(Sbdf2Solver.AlphaH, Sbdf2Solver.BetaH, v[j], vPre[j], hg[j], hPre[j], out fh[j], out fhP[j]);
    }
    bool on = t >= clampStart && t < clampStart + clampLen, onPre = s > 0 && t - dt >= clampStart && t - dt < clampStart + clampLen;
    if (iinj != 0) { if (on) f[stim] += iDensity; if (onPre) fPre[stim] += iDensity; }
    double[] r;
    if (s == 0)
    {
        r = new double[n];
        for (int j = 0; j < n; j++) { nNew[j] = ng[j] + dt * fn[j]; mNew[j] = mg[j] + dt * fm[j]; hNew[j] = hg[j] + dt * fh[j]; r[j] = v[j] + dt * f[j]; }
    }
    else
    {
        Sbdf2Solver.StateExplicitSbdf2(ng, nPre, fn, fnP, dt, nNew);
        Sbdf2Solver.StateExplicitSbdf2(mg, mPre, fm, fmP, dt, mNew);
        Sbdf2Solver.StateExplicitSbdf2(hg, hPre, fh, fhP, dt, hNew);
        r = solver.BuildRhs(v, vPre, f, fPre, dt);
    }
    Array.Copy(v, vPre, n); Array.Copy(ng, nPre, n); Array.Copy(mg, mPre, n); Array.Copy(hg, hPre, n);
    Array.Copy(nNew, ng, n); Array.Copy(mNew, mg, n); Array.Copy(hNew, hg, n);

    bool clamped = iinj == 0 && on;
    if (s == 0) solver.SolveStartup(r, vNew);
    else if (clamped) vNew = solver.SolveRank1(r, stim, SimParams.VClamp);
    else solver.SolvePlain(r, vNew);
    Array.Copy(vNew, v, n);
}
Console.WriteLine($"{steps} steps in {sw.Elapsed.TotalSeconds:F1} s, {frames} frames; spike at the soma at {firstSomaSpike * 1e3:F2} ms");
File.WriteAllText(Path.Combine(outDir, "meta.txt"), string.Join("\n", new[] {
    $"nodes {n}", $"frames {frames}", $"frame_dt_s {(dt * recEvery).ToString(inv)}", $"dt_s {dt.ToString(inv)}",
    $"stim {stim}", $"stim_dist_um {dist[stim].ToString("F1", inv)}", $"soma {soma}",
    $"clamp_start_s {clampStart.ToString(inv)}", $"clamp_len_s {clampLen.ToString(inv)}", $"clamp_V {SimParams.VClamp.ToString(inv)}", $"iinj_A {iinj.ToString(inv)}",
    $"soma_spike_s {firstSomaSpike.ToString(inv)}" }) + "\n");

double[] Fill(double x) { var a = new double[n]; Array.Fill(a, x); return a; }
static void Gate(Func<double, double> a, Func<double, double> b, double v, double vp, double s, double sp, out double fc, out double fp)
{
    fc = a(v) * (1 - s) - b(v) * s;
    fp = a(vp) * (1 - sp) - b(vp) * sp;
}
