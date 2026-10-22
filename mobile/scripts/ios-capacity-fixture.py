"""Public 96MiB v1 fixture exclusively for the newly created CI simulator."""
import json,pathlib,sqlite3,sys
sample=json.loads(pathlib.Path('ios/build/native-sample.json').read_text())
target=pathlib.Path(sys.argv[1])
if target.exists(): raise RuntimeError('Refusing to overwrite any existing database')
target.parent.mkdir(parents=True,exist_ok=True)
root={k:v for k,v in sample.items() if k!='records'}
root['settings'].pop('autoBackup',None)
base=next(r for r in sample['records'] if r['sourceType']=='manual')
encode=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'))
db=sqlite3.connect(target)
db.executescript('PRAGMA user_version=1; CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,position INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL);')
db.execute('INSERT INTO state VALUES(1,?,1)',(encode(root),))
body=encode({'manualContent':'PUBLIC_CAPACITY_BEGIN😀\0'+'A'*(1024*1024)+'PUBLIC_CAPACITY_END'})
for index in range(96):
 row={k:v for k,v in base.items() if k not in ('rawContent','manualContent')}
 row.update(id=f'public-capacity-{index}',name=f'公开容量场次{index}',order=index)
 db.execute('INSERT INTO records VALUES(?,?,?,?)',(row['id'],index,encode(row),body))
db.commit()
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
db.close()
print('PUBLIC_WK_CAPACITY_FIXTURE records=96 bytes='+str(target.stat().st_size))
