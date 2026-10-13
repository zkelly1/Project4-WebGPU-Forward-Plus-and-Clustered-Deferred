import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root=Path(__file__).resolve().parents[1]
data=json.loads((root/'results/benchmark.json').read_text(encoding='utf-8'))
rows=data['results']
colors={'Naive':'#777777','Forward+':'#2878b5','Deferred':'#e07b24'}
fig,axes=plt.subplots(1,2,figsize=(11,4.5),layout='constrained')
for ax,width in zip(axes,[640,1280]):
    for name,color in colors.items():
        selected=[r for r in rows if r['width']==width and r['renderer']==name and r['bundles']]
        ax.plot([r['lights'] for r in selected],[r['gpuMs'] for r in selected],marker='o',label=name,color=color)
    ax.set(title=f'{width} × {360 if width==640 else 720}',xlabel='Active point lights',ylabel='Median GPU pass time (ms)',yscale='log')
    ax.grid(alpha=.25);ax.legend()
fig.suptitle('Sponza: GPU render time by light count (log scale)')
fig.savefig(root/'img/performance.png',dpi=170)
plt.close(fig)
fig,axes=plt.subplots(1,2,figsize=(11,4.5),layout='constrained')
for ax,metric,title in zip(axes,['cpuMs','gpuMs'],['CPU draw encoding','GPU pass time']):
    for name,color in colors.items():
        for bundles,style in [(False,'--'),(True,'-')]:
            selected=[r for r in rows if r['width']==1280 and r['renderer']==name and r['bundles']==bundles]
            ax.plot([r['lights'] for r in selected],[r[metric] for r in selected],style,marker='o',color=color,label=f'{name}, {"bundles" if bundles else "direct"}')
    ax.set(title=title,xlabel='Active point lights',ylabel='Median time (ms)');ax.grid(alpha=.25)
    if metric=='gpuMs':ax.set_yscale('log')
    else:
        ax.set_ylim(0,0.25)
        ax.text(0.04,0.9,'All three renderers overlap at this timer resolution',transform=ax.transAxes,fontsize=9)
axes[1].legend(fontsize=8)
fig.suptitle('Render bundles at 1280 × 720: before and after')
fig.savefig(root/'img/render-bundles.png',dpi=170)
plt.close(fig)
lines=['| Resolution | Lights | Naive | Forward+ | Deferred |','| --- | ---: | ---: | ---: | ---: |']
for width,height in [(640,360),(1280,720)]:
    for count in [1,500,1000,2500,5000]:
        selected={r['renderer']:r for r in rows if r['width']==width and r['lights']==count and r['bundles']}
        lines.append(f'| {width} × {height} | {count:,} | '+ ' | '.join(f"{selected[n]['gpuMs']:.3f}" for n in colors)+' |')
(root/'results/table.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('\n'.join(lines))
print('5000 light pass breakdown',[(r['renderer'],r['passes']) for r in rows if r['width']==1280 and r['lights']==5000 and r['bundles']])
