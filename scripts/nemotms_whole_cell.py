#!/usr/bin/env python3
"""Writes a copy of the toolbox's calcium script in which the axon has the same calcium mechanisms as the rest of the cell.

The toolbox's script gives the axon no channels, pumps, buffer or diffusion, so its calcium stays at rest. The NeMo-TMS
page shows calcium across the whole cell, so its run uses this copy, with the ER off (-setting none)."""
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:3])
s = source.read_text()
ALL = '"soma, apic, dend, axon"'
for old in ('diffCaCyt = ConvectionDiffusion("ca_cyt", "soma, apic, dend", "fv1")',
            'diffCaER = ConvectionDiffusion("ca_er", "soma, apic, dend", "fv1")',
            'diffClb = ConvectionDiffusion("clb", "soma, apic, dend", "fv1")',
            'discBuffer = BufferFV1("soma, apic, dend")',
            'discPMCA = MembraneTransport1d("soma, apic, dend", pmca)',
            'discNCX = MembraneTransport1d("soma, apic, dend", ncx)',
            'discPMLeak = MembraneTransport1d("soma, apic, dend", leakPM)',
            'discVDCC = MembraneTransport1d("soma, apic, dend", vdcc)'):
    assert s.count(old) == 1, old
    s = s.replace(old, old.replace('"soma, apic, dend"', ALL))
# the mass-only axon equations are replaced by the above
for old in ('if withAxon == "AX" then\n\tdiffCaCytAxon = ConvectionDiffusion', 'if withAxon == "AX" then\n\tdomDisc:add(diffCaCytAxon)'):
    assert s.count(old) == 1, old
    s = s.replace(old, old.replace('withAxon == "AX"', 'false'))
target.write_text(s)
