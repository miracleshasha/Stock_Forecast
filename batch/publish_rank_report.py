"""Publish report to PRIVATE Supabase Storage; never add report data to the public repo.

python publish_rank_report.py --report logs/rank-evaluation/report.json
Requires existing batch service credentials. No table/policy changes, public URLs, or signed URLs.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import requests
import config
import supabase_io

BUCKET = 'owner-model-research'
OBJECT = 'rank-evaluation/latest.json'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report',type=Path,default=Path(__file__).parent/'logs/rank-evaluation/report.json')
    args=parser.parse_args()
    config.require_supabase()
    report=json.loads(args.report.read_text())
    if report.get('adoption')!='research_only':
        raise ValueError('Only research reports may be published here')
    # Full trade ledgers/diagnostic tickers stay local; dashboard needs counts only.
    report['diagnostics']=[{'run':d['run'],'stale_count':len(d['stale_events']),
                            'structural_count':len(d['structural_events']),
                            'unliquidated_count':len(d['unliquidated'])} for d in report['diagnostics']]
    body=json.dumps(report,ensure_ascii=False,allow_nan=False).encode()
    headers=supabase_io._headers()
    base=config.SUPABASE_URL+'/storage/v1'
    bucket=requests.get(base+'/bucket/'+BUCKET,headers=headers,timeout=30)
    if bucket.status_code in (400,404) and bucket.json().get('message') in ('Bucket not found','The resource was not found'):
        bucket=requests.post(base+'/bucket',headers=headers,json={'id':BUCKET,'name':BUCKET,'public':False,
                            'allowed_mime_types':['application/json'],'file_size_limit':1048576},timeout=30)
        bucket.raise_for_status()
        bucket=requests.get(base+'/bucket/'+BUCKET,headers=headers,timeout=30)
    bucket.raise_for_status()
    if bucket.json().get('public') is not False:
        raise ValueError('Refusing to publish to a non-private bucket')
    upload=requests.post(base+'/object/'+BUCKET+'/'+OBJECT,headers={**headers,'x-upsert':'true',
                          'content-type':'application/json','cache-control':'60'},data=body,timeout=30)
    upload.raise_for_status()
    download=requests.get(base+'/object/authenticated/'+BUCKET+'/'+OBJECT,headers=headers,timeout=30)
    download.raise_for_status()
    assert download.json()['fingerprint']==report['fingerprint']
    public=requests.get(base+'/object/public/'+BUCKET+'/'+OBJECT,timeout=30)
    assert public.status_code>=400, 'Public download must be rejected'
    print('Private report uploaded and read back. Public URL rejected:',public.status_code)

if __name__=='__main__':main()
