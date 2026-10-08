import pathlib, zipfile, hashlib, json, os
root=pathlib.Path(__file__).resolve().parent.parent
qa=pathlib.Path(os.environ.get('NPO_QA_DIR') or str(root/'qa')).resolve()
names=['index.html','NPO结构探索器.html','database.json','database.sqlite','README.md','THIRD_PARTY_LICENSES.txt','package.json','package-lock.json','.gitignore','.gitattributes','.nojekyll','docs/overview.png','research/architecture.json','research/cost-suppliers.json','research/search-aliases.json']
names += [str(p.relative_to(root)) for folder in ['web','scripts'] for p in (root/folder).glob('*') if p.is_file()]
files={n:root/n for n in names}
receipt_path=qa/'browser-results.json'
if not receipt_path.is_file():
 raise SystemExit(f'Browser QA receipt is missing: {receipt_path}. Run node scripts/render-qa.cjs first, using the same NPO_QA_DIR if set.')
try:
 receipt=json.loads(receipt_path.read_text(encoding='utf-8'))
except (OSError,UnicodeError,json.JSONDecodeError) as exc:
 raise SystemExit(f'Unable to read browser QA receipt {receipt_path}: {exc}') from exc
if not isinstance(receipt,dict) or receipt.get('passed') is not True or receipt.get('errors')!=[] or receipt.get('externalRequests')!=[]:
 raise SystemExit(f'Browser QA did not pass or its receipt is incomplete: {receipt_path}. Rerun node scripts/render-qa.cjs before packaging.')
artifact=root/'NPO结构探索器.html'
if not artifact.is_file():
 raise SystemExit(f'Generated HTML is missing: {artifact}. Run npm run build and browser QA before packaging.')
if receipt.get('artifactSha256')!=hashlib.sha256(artifact.read_bytes()).hexdigest():
 raise SystemExit(f'Browser QA does not match the current HTML: {receipt_path}. Rerun node scripts/render-qa.cjs before packaging.')
qa_images=sorted(qa.glob('0*.png'))
if not qa_images:
 raise SystemExit(f'Browser QA screenshots are missing from {qa}. Rerun node scripts/render-qa.cjs using the same NPO_QA_DIR before packaging.')
files['qa/browser-results.json']=receipt_path
files.update({'qa/'+p.name:p for p in qa_images})
manifest={n:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for n,p in sorted(files.items())}
(qa/'delivery-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
target=root/'NPO结构探索器_源码与数据库_20261008.zip'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
 for n,p in files.items():z.write(p,n)
 z.write(qa/'delivery-manifest.json','qa/delivery-manifest.json')
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None
 for n in files:assert hashlib.sha256(z.read(n)).hexdigest()==manifest[n]['sha256']
print(json.dumps({'archive':str(target),'files':len(files)+1,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False))
