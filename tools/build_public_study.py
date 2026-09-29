"""Reproduce a public SPTS dataset study; never infer missing engineering units."""
import argparse,csv,hashlib,io,json,sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'.test-tools/data-libs'))
import numpy as np
from netCDF4 import Dataset
BASE='https://zenodo.org/records/17122442/files/'
FILES={'Process_data.nc':'4567d24ec2125102a2e5129203ba31fa','Dictionary_process.nc':'0dde5a3a913eb1fa8512ef2f8748fb34','Si_Oxide_etch_9_points.csv':'78515caf25e29e558e1859b92f8a4827','Readme.pdf':'f9a9bd323bd9e227a486249a631e8468'}
TAGS=['Pressure','PlatenRFLoadPower','SourceRFLoadPower','Gas1Flow','Gas4Flow','Gas5Flow','HeliumBPPressure','Heater2Temp','Heater3Temp']
PREFIX='Stat3_Etch_MV_'

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--download',action='store_true');args=parser.parse_args()
    source=ROOT/'.test-tools/public-equipment-source';source.mkdir(parents=True,exist_ok=True)
    files=[]
    for name,expected in FILES.items():
        path=source/name
        if not path.exists() and args.download:
            with urlopen(BASE+name,timeout=90) as response:path.write_bytes(response.read())
        raw=path.read_bytes()
        if hashlib.md5(raw).hexdigest()!=expected:raise ValueError('Source checksum mismatch: '+name)
        files.append({'name':name,'url':BASE+name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'publisherMd5':expected})
    measurements={}
    for row in csv.DictReader(io.StringIO((source/'Si_Oxide_etch_9_points.csv').read_text())):
        measurements.setdefault(row['experiment_key'],[]).append(row)
    records=[];excluded=[]
    with Dataset('dictionary',memory=(source/'Dictionary_process.nc').read_bytes()) as ds:decoder=np.asarray(ds['data'][:])
    with Dataset('process',memory=(source/'Process_data.nc').read_bytes()) as ds:
        for name,g in ds.groups.items():
            parts=name.split('_');day='-'.join(parts[1:4]);wafer=parts[-1];key=day+'_'+wafer
            if key not in measurements or len(measurements[key])!=9:excluded.append({'id':key,'reason':'nine measured positions unavailable'});continue
            rows=measurements[key];truth=np.array([float(r['si_etch']) for r in rows]);times=np.asarray(g['times'][:],dtype=float);names=g['feature'][:].tolist();values=np.asarray(decoder[g['data'][:]],dtype=float);chosen=values[:,[names.index(PREFIX+tag) for tag in TAGS]]
            if not np.isfinite(chosen).all() or not np.isfinite(truth).all() or len(times)<2 or not np.all(np.diff(times)>0):excluded.append({'id':key,'reason':'nonfinite or unordered data'});continue
            features=np.array([[np.mean(v),np.std(v),np.quantile(v,.1),np.quantile(v,.9)] for v in chosen.T]).ravel()
            idx=np.unique(np.linspace(0,len(times)-1,81).round().astype(int))
            records.append({'id':key,'group':name,'day':day,'wafer':wafer,'lot':rows[0]['lot_number'],'samples':len(times),'sourceChannelCount':len(names),'durationSeconds':float(times[-1]-times[0]),'rawTimeFirst':float(times[0]),'timeUnits':g['times'].units,'maxGapSeconds':float(np.diff(times).max()),'features':features.tolist(),'measuredDepthUm':float(truth.mean()),'measurementSites':[{'location':r['loc_id'],'siEtchUm':float(r['si_etch'])} for r in rows],'trace':{'t':(times[idx]-times[0]).tolist(),'values':chosen[idx].tolist()}})
    records.sort(key=lambda r:r['id']);days=sorted(set(r['day'] for r in records));test_day=days[-1]
    X=np.array([r['features'] for r in records]);y=np.array([r['measuredDepthUm'] for r in records]);test=np.array([r['day']==test_day for r in records]);train=~test
    mean=X[train].mean(axis=0);scale=X[train].std(axis=0);scale[scale<1e-12]=1
    z=(X-mean)/scale;intercept=float(y[train].mean());alpha=10.0
    coefficients=np.linalg.solve(z[train].T@z[train]+alpha*np.eye(z.shape[1]),z[train].T@(y[train]-intercept))
    predicted=z@coefficients+intercept
    def scores(a,b):return {'maeUm':float(np.mean(np.abs(a-b))),'rmseUm':float(np.sqrt(np.mean((a-b)**2))),'maxAbsErrorUm':float(np.max(np.abs(a-b)))}
    for r,p,t in zip(records,predicted,test):r.update(predictedDepthUm=float(p),split='test' if t else 'train')
    bundle={'schema':'waferflow-public-study-v1','modelVersion':'spts-ridge-1.0.0','source':{'title':'BOSCH plasma etching — process data and nine-point wafer metrology','authors':['Mudassir Ali Sayyed','Tom Seifert','Stephan Zieger','Simeon Schwarzenberg','Aditya Deshmukh','Micha Haase','Jan Langer'],'url':'https://zenodo.org/records/17122442','doi':'10.5281/zenodo.17122442','license':'CC-BY-4.0','equipment':'SPTS Omega i2L DSi Rapier','files':files},'audit':{'sourceGroups':len(records)+len(excluded),'includedRuns':len(records),'excluded':excluded,'sensorUnits':'not declared in NetCDF; native numeric scale retained without engineering-unit inference','clock':'time values near 1970 conflict with 2024 group names; relative intervals only, no absolute UTC claimed','quality':'no instrument quality flags; finite values and monotonic time checked only','physicalModelConnection':'blocked: engineering units and absolute time origin require confirmation; BOSCH chemistry and geometry differ from the CMOS etch model'},'features':[{'tag':PREFIX+tag,'statistic':stat,'unit':'native (not declared)'} for tag in TAGS for stat in ['mean','std','p10','p90']],'traceTags':[PREFIX+t for t in TAGS],'model':{'type':'ridge','alpha':alpha,'selection':'alpha=10 fixed before viewing held-out outcomes; no test-driven tuning','mean':mean.tolist(),'scale':scale.tolist(),'coefficients':coefficients.tolist(),'intercept':intercept,'trainMinimum':X[train].min(axis=0).tolist(),'trainMaximum':X[train].max(axis=0).tolist(),'target':'mean of nine measured Si etch depths','targetUnit':'um'},'validation':{'split':'last experiment day held out; all wafers from a day remain together','testDay':test_day,'trainRuns':int(train.sum()),'testRuns':int(test.sum()),'heldOut':scores(y[test],predicted[test]),'training':scores(y[train],predicted[train]),'constantBaseline':scores(y[test],np.full(test.sum(),intercept))},'records':records,'limitations':['Offline completed-run prediction, not live endpoint control.','Native sensor scales are not confirmed physical units.','No causal recipe optimization or BOSCH-to-CMOS equivalence.','Performance on one held-out day is not multi-fab validation.','The nine-point mean is a measured target, not an entire-wafer map.','Chart traces are decimated to 81 original points; model features use every original sample.']}
    output=ROOT/'public-data';output.mkdir(exist_ok=True);(output/'spts-study.json').write_text(json.dumps(bundle,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    report=source/'heldout-predictions.csv'
    with report.open('w',newline='',encoding='utf-8-sig') as stream:
        writer=csv.writer(stream);writer.writerow(['run','split','measured_depth_um','predicted_depth_um','error_um'])
        for r in records:writer.writerow([r['id'],r['split'],r['measuredDepthUm'],r['predictedDepthUm'],r['predictedDepthUm']-r['measuredDepthUm']])
    print(json.dumps({'audit':bundle['audit'],'validation':bundle['validation'],'outputBytes':(output/'spts-study.json').stat().st_size},indent=2))
if __name__=='__main__':main()
