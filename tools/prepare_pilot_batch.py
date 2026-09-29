"""Join explicit run context and metrology to normalized telemetry without guessing units."""
import argparse,csv,hashlib,json,math
from pathlib import Path

COLUMNS=['packet_file','role','recipe_revision','product_id','route_revision','history_file','measured_value','measured_unit','measured_at','instrument_id','method']
LIMIT=20*1024*1024

def prepare(manifest,input_root):
    root=Path(input_root).resolve();manifest=Path(manifest)
    if manifest.stat().st_size>LIMIT:raise ValueError('Manifest exceeds 20 MB')
    with manifest.open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.DictReader(stream)
        if reader.fieldnames!=COLUMNS:raise ValueError('CSV columns must exactly match: '+','.join(COLUMNS))
        rows=list(reader)
    if not 1<=len(rows)<=100:raise ValueError('Use 1–100 rows')
    total=0;seen=set();runs=[]
    def load(name):
        nonlocal total
        if not isinstance(name,str) or not name.strip():raise ValueError('File name is required')
        path=(root/name).resolve()
        if not path.is_relative_to(root) or not path.is_file():raise ValueError('Input file must stay inside input-root: '+name)
        size=path.stat().st_size;total+=size
        if size>LIMIT or total>LIMIT:raise ValueError('Input total exceeds 20 MB')
        raw=path.read_bytes()
        return json.loads(raw.decode('utf-8-sig'),parse_constant=lambda x:(_ for _ in ()).throw(ValueError('Nonfinite JSON number'))),hashlib.sha256(raw).hexdigest()
    for index,row in enumerate(rows,1):
        if None in row or any(v is None for v in row.values()):raise ValueError(f'Row {index}: missing/extra CSV cells')
        for k in ['packet_file','role','recipe_revision','product_id','route_revision']:
            if not row[k].strip() or row[k]!=row[k].strip():raise ValueError(f'Row {index}: explicit {k} required')
        if row['role'] not in ['baseline','monitor']:raise ValueError(f'Row {index}: invalid role')
        packet,sha=load(row['packet_file'])
        if not isinstance(packet,dict) or packet.get('schema')!='waferflow-fab-telemetry-v1':raise ValueError(f'Row {index}: normalized telemetry JSON required')
        key=tuple(packet.get(k) for k in ['equipmentId','chamberId','runId'])
        if not all(isinstance(k,str) and k.strip() for k in key) or key in seen:raise ValueError(f'Row {index}: missing or duplicate run identity')
        seen.add(key)
        item={'packet':packet,'role':row['role'],'recipeRevision':row['recipe_revision'],'productId':row['product_id'],'routeRevision':row['route_revision'],'provenance':{'packetFile':row['packet_file'],'packetSha256':sha,'hashKind':'original-file-bytes','contextSource':'explicit-manifest-declaration','verified':False}}
        measured=[row[k] for k in ['measured_value','measured_unit','measured_at','instrument_id','method']]
        if any(measured):
            if not all(v.strip() for v in measured):raise ValueError(f'Row {index}: complete all metrology fields or leave all empty')
            value=float(row['measured_value'])
            if not math.isfinite(value):raise ValueError(f'Row {index}: finite measurement required')
            item['measured']={'value':value,'unit':row['measured_unit'],'measuredAt':row['measured_at'],'instrumentId':row['instrument_id'],'method':row['method']}
        if row['history_file']:
            history,hsha=load(row['history_file'])
            if not isinstance(history,dict) or not isinstance(history.get('records'),list):raise ValueError(f'Row {index}: history requires records')
            item['history']=history;item['provenance']['historySha256']=hsha
        runs.append(item)
    output={'schema':'waferflow-pilot-batch-v1','runs':runs}
    if len(json.dumps(output,ensure_ascii=False,allow_nan=False).encode('utf-8'))>LIMIT:raise ValueError('Output exceeds browser 20 MB limit')
    return output

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',required=True);parser.add_argument('--input-root',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    result=prepare(args.manifest,args.input_root)
    # Exclusive creation prevents overwriting a source log or an earlier review batch.
    with Path(args.output).open('x',encoding='utf-8') as stream:json.dump(result,stream,ensure_ascii=False,allow_nan=False)
    print(f'Prepared {len(result["runs"])} runs. Validate scope, units, quality and timing in fab-pilot.html before use.')
if __name__=='__main__':main()
