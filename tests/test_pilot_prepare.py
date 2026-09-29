import csv,importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('pilot_prepare',ROOT/'tools/prepare_pilot_batch.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.packet=json.loads((ROOT/'examples/fab-data-clean.json').read_text(encoding='utf-8'))
        (self.root/'packet.json').write_text(json.dumps(self.packet))
        self.row=['packet.json','monitor','r1','product','route','','','','','','']
    def write(self,rows):
        path=self.root/'manifest.csv'
        with path.open('w',newline='',encoding='utf-8') as f:
            w=csv.writer(f);w.writerow(mod.COLUMNS);w.writerows(rows)
        return path
    def test_preserves_packet_and_hash_without_synthetic_metrology(self):
        r=mod.prepare(self.write([self.row]),self.root)['runs'][0];self.assertEqual(r['packet'],self.packet);self.assertNotIn('measured',r);self.assertEqual(len(r['provenance']['packetSha256']),64)
    def test_explicit_complete_metrology(self):
        self.row[6:]=['1.2','nm','2026-09-21T01:00:00Z','TOOL','ellipsometry'];r=mod.prepare(self.write([self.row]),self.root);self.assertEqual(r['runs'][0]['measured']['value'],1.2)
    def test_rejects_partial_metrology(self):
        self.row[6]='1.2'
        with self.assertRaises(ValueError):mod.prepare(self.write([self.row]),self.root)
    def test_duplicate_identity(self):
        with self.assertRaises(ValueError):mod.prepare(self.write([self.row,self.row]),self.root)
    def test_path_escape(self):
        self.row[0]='../outside.json'
        with self.assertRaises(ValueError):mod.prepare(self.write([self.row]),self.root)
    def test_nonfinite_measurement(self):
        self.row[6:]=['NaN','nm','2026-09-21T01:00:00Z','TOOL','method']
        with self.assertRaises(ValueError):mod.prepare(self.write([self.row]),self.root)
    def test_role_and_metadata_required(self):
        self.row[1]='train'
        with self.assertRaises(ValueError):mod.prepare(self.write([self.row]),self.root)
if __name__=='__main__':unittest.main()
