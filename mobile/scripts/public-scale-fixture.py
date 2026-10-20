import json, sqlite3, pathlib, sys
target=pathlib.Path(sys.argv[1]).resolve()
assert not target.exists()
date='2026-10-20T00:00:00.000Z'
modules=[dict(id=f'public-module-{i}',name=f'公开压力模组 {i+1:02d}',playStatus='running',kps=['公开主持人'],pairs=[],order=i,collapsed=True,createdAt=date,updatedAt=date) for i in range(50)]
records=[]
for i in range(1000):
    url=f'https://log.weizaima.com/?key=public-pressure-{i}'
    records.append(dict(id=f'public-record-{i}',moduleId=modules[i//20]['id'],name=f'公开场次 {i+1}',sequenceNo=i%20+1,sourceType='online',status='valid',dateSource='none',order=i,createdAt=date,updatedAt=date,link=url,cacheSourceUrl=url,fetchedAt=date,
        rawContent=dict(parserVersion=1,sourceUrl=url,messages=[dict(id=f'old-{i}',order=0,displayName='公开主持人',text='A'*52000+'中文😀末尾',type='text',isDiceCommand=False,isOffTopic=False,images=[],raw=900719925474099312345)])))
for i in range(50):
    records.append(dict(id=f'public-manual-{i}',moduleId=modules[i]['id'],name='公开手动正文',sequenceNo=21,sourceType='manual',status='manual',dateSource='none',order=1000+i,createdAt=date,updatedAt=date,manualContent='公开手动内容😀\n\n'*100))
settings=dict(theme='light',filterPreset={k:k in ['hidePlatformAccount','hideYearMonthDay'] for k in ['hideDiceCommands','hideImages','hideOffTopic','hideTime','hidePlatformAccount','hideYearMonthDay','indentFirstLine','darkDisplay']})
snapshot=dict(schemaVersion=2,exportedAt=date,modules=modules,records=records,characters=[],settings=settings)
raw=json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))
with sqlite3.connect(target) as db:
    db.execute('CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL)')
    db.execute("INSERT INTO app_state VALUES(1,'chunked-v1',7)")
    db.execute('CREATE TABLE snapshot_chunks(position INTEGER PRIMARY KEY,data TEXT NOT NULL)')
    db.execute('CREATE TABLE snapshot_fields(field TEXT,position INTEGER,data TEXT,PRIMARY KEY(field,position))')
    db.executemany('INSERT INTO snapshot_chunks VALUES(?,?)',((i,raw[start:start+64000]) for i,start in enumerate(range(0,len(raw),64000))))
    db.execute('PRAGMA user_version=3')
print(json.dumps(dict(modules=50,online=1000,manual=50,snapshotBytes=len(raw.encode()),databaseBytes=target.stat().st_size)))
