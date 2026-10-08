import json, sqlite3, pathlib
root=pathlib.Path(__file__).resolve().parent.parent
data=json.loads((root/'database.json').read_text())
temp=root/'database.next.sqlite'
if temp.exists():temp.unlink()
c=sqlite3.connect(temp)
c.executescript('''
CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE components (id TEXT PRIMARY KEY,parent_id TEXT,name TEXT,category TEXT,quantity_rule TEXT,json TEXT NOT NULL);
CREATE TABLE vendors (id TEXT PRIMARY KEY,name TEXT,region TEXT,json TEXT NOT NULL);
CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT,url TEXT,publication_date TEXT,checked_date TEXT,json TEXT NOT NULL);
CREATE TABLE component_vendors (component_id TEXT,vendor_id TEXT,role TEXT,json TEXT NOT NULL);
CREATE TABLE architectures (id TEXT PRIMARY KEY,label TEXT,json TEXT NOT NULL);
CREATE INDEX component_vendor_lookup ON component_vendors(component_id,vendor_id);
''')
dump=lambda x:json.dumps(x,ensure_ascii=False)
for k,v in data.items():
 if k not in ['components','vendors','sources','architectures']:c.execute('INSERT INTO metadata VALUES (?,?)',(k,dump(v)))
for n in data['components']:
 c.execute('INSERT INTO components VALUES (?,?,?,?,?,?)',(n['id'],n['parent'],n['name'],n['category'],n['qtyRule'],dump(n)))
 for v in n['vendorLinks']:c.execute('INSERT INTO component_vendors VALUES (?,?,?,?)',(n['id'],v['vendor_id'],v['role'],dump(v)))
for k,v in data['vendors'].items():c.execute('INSERT INTO vendors VALUES (?,?,?,?)',(k,v['name'],v['region'],dump(v)))
for s in data['sources']:c.execute('INSERT INTO sources VALUES (?,?,?,?,?,?)',(s['id'],s['title'],s['url'],s.get('date'),s.get('accessed'),dump(s)))
for a in data['architectures']:c.execute('INSERT INTO architectures VALUES (?,?,?)',(a['id'],a['label'],dump(a)))
c.commit();assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';c.close()
temp.replace(root/'database.sqlite')
