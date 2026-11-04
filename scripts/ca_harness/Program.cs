// The calcium page's background data: Neuro-VISOR's calcium model (CalciumModel + SomaLattice + CalciumGeometry from
// the calcium-model branch, compiled outside Unity) on the CA1 graph, with the write-up's stimulus: a click held for
// 20 ms (Hold influx) on the thick apical trunk 35-45 um from the soma center.
// Writes <out>/meta.txt and <out>/ca.f32: float32 per frame, [n] cytosolic then [n] ER calcium [mM] of every 1D node
// (nodes inside the soma show their nearest lattice cell), then the soma lattice's mean cytosolic and ER calcium.
//
// usage: harness <graph.txt> <outDir> [tEnd_s=0.4] [frame_s=0.002] [hold_s=0.02]
using System; using System.Collections.Generic; using System.IO; using System.Linq; using System.Globalization;
using C2M2.NeuronalDynamics.Simulation;
class Program {
  static void Main(string[] a) {
    var inv = CultureInfo.InvariantCulture;
    string graph = a[0], outDir = a[1];
    double tEnd = a.Length > 2 ? double.Parse(a[2], inv) : 0.4, frameDt = a.Length > 3 ? double.Parse(a[3], inv) : 0.002;
    double hold = a.Length > 4 ? double.Parse(a[4], inv) : 0.02, t0 = 0.005;
    Directory.CreateDirectory(outDir);
    var lines = File.ReadAllLines(graph); var hd = lines[0].Split(' ').Select(int.Parse).ToArray();
    int n = hd[0], ne = hd[1]; double[] x = new double[n], y = new double[n], z = new double[n]; var r = new List<double>();
    for (int i = 0; i < n; i++) { var p = lines[1 + i].Split(' ').Select(s => double.Parse(s, inv)).ToArray(); x[i] = p[0]; y[i] = p[1]; z[i] = p[2]; r.Add(p[3]); }
    var adj = Enumerable.Range(0, n).Select(_ => new Dictionary<int, double>()).ToList();
    for (int e = 0; e < ne; e++) { var p = lines[1 + n + e].Split(' '); int u = int.Parse(p[0]), v = int.Parse(p[1]); double l = double.Parse(p[2], inv); adj[u][v] = l; adj[v][u] = l; }
    var soma = lines[1 + n + ne].Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();
    var adjRO = adj.Select(d => (IReadOnlyDictionary<int, double>)d).ToList();
    var P = new CalciumParameters(); double dt = 50e-6, h = 1.5;
    var L = SomaLattice.Build(x, y, z, r, adjRO, soma, P, h);
    var model = new CalciumModel(L.Geometry, P, dt);

    // the click: the thickest node 35-45 um from the soma center, and the nodes within 2 um of it
    Func<int, double, double, double, double> dist = (i, cx, cy, cz) => Math.Sqrt((x[i] - cx) * (x[i] - cx) + (y[i] - cy) * (y[i] - cy) + (z[i] - cz) * (z[i] - cz));
    int stim = Enumerable.Range(0, n).Where(i => { double d = dist(i, L.Cx, L.Cy, L.Cz); return d > 35 && d < 45 && !L.Removed[i]; }).OrderByDescending(i => r[i]).First();
    var hit = Enumerable.Range(0, n).Where(i => dist(i, x[stim], y[stim], z[stim]) < 2.0).ToArray();

    // what each 1D node shows: itself, or (inside the soma) its nearest lattice cell
    var cyt = new int[n]; var er = new int[n];
    for (int i = 0; i < n; i++) {
      cyt[i] = er[i] = i;
      if (!L.Removed[i]) continue;
      cyt[i] = L.N1D + L.NearestCell(x[i], y[i], z[i], L.CytVolume);
      er[i] = L.N1D + L.NearestCell(x[i], y[i], z[i], L.ErVolume);
    }

    int steps = (int)Math.Round(tEnd / dt), every = (int)Math.Round(frameDt / dt), frames = 0;
    using (var bw = new BinaryWriter(File.Create(Path.Combine(outDir, "ca.f32")))) {
      for (int s = 0; s <= steps; s++) {
        if (s % every == 0) {
          for (int i = 0; i < n; i++) bw.Write((float)model.Cc[cyt[i]]);
          for (int i = 0; i < n; i++) bw.Write((float)model.Ce[er[i]]);
          bw.Write((float)L.Mean(model.Cc, false)); bw.Write((float)L.Mean(model.Ce, true));
          frames++;
        }
        if (s == steps) break;
        bool on = model.Time >= t0 && model.Time < t0 + hold;
        foreach (int v in hit) model.HoldInflux[v] = on ? P.influxAmplitude : 0;
        model.Step();
        if (double.IsNaN(model.Cc[0])) { Console.WriteLine("diverged at " + model.Time); break; }
        if (s % (steps / 10) == 0) Console.WriteLine($"  t = {model.Time * 1e3:F0} ms");
      }
    }
    File.WriteAllText(Path.Combine(outDir, "meta.txt"), string.Join("\n", new[] {
      $"nodes {n}", $"frames {frames}", $"frame_dt_s {frameDt.ToString(inv)}", $"stim {stim}", $"hits {hit.Length}",
      $"hold_start_s {t0.ToString(inv)}", $"hold_s {hold.ToString(inv)}", $"lattice_cells {L.Cells}", $"lattice_h_um {h.ToString(inv)}",
      $"er_radius_ratio {P.erRadiusRatio.ToString(inv)}", $"cc_rest_mM {model.Cc[n - 1].ToString(inv)}" }) + "\n");
    Console.WriteLine(File.ReadAllText(Path.Combine(outDir, "meta.txt")));
  }
}
