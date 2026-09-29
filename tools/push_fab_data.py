"""Submit one run packet through the authenticated site-local collector API."""
import argparse
import getpass
import http.cookiejar
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request,build_opener,HTTPCookieProcessor
from urllib.error import HTTPError

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',required=True,help='현장 WaferFlow 서버 URL')
    parser.add_argument('--file',required=True,help='공통 형식 JSON 장비 운전 로그')
    parser.add_argument('--username',required=True)
    args=parser.parse_args()
    parsed=urlsplit(args.url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/') or (parsed.scheme!='https' and not(parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1','::1'))):
        parser.error('HTTPS 서버 주소 또는 localhost HTTP 주소를 사용하세요. URL에 계정 정보를 넣지 마세요.')
    raw=Path(args.file).read_bytes()
    if len(raw)>1500000:parser.error('최대 1.5 MB 파일만 전송합니다.')
    packet=json.loads(raw.decode('utf-8-sig'))
    if not isinstance(packet,dict) or packet.get('schema')!='waferflow-fab-telemetry-v1':parser.error('공통 장비 로그 JSON이 필요합니다.')
    password=os.getenv('WF_COLLECTOR_PASSWORD') or getpass.getpass('현장 서버 비밀번호: ')
    client=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def post(path,payload,csrf=''):
        request=Request(args.url.rstrip('/')+'/api'+path,data=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode(),headers={'Content-Type':'application/json','X-WaferFlow':'review','X-CSRF-Token':csrf})
        try:
            with client.open(request,timeout=30) as response:return json.load(response)
        except HTTPError as error:
            raise SystemExit('서버 요청 실패: HTTP '+str(error.code)+'. 계정·권한·형식·운전 ID 충돌을 확인하세요.') from None
    login=post('/login',{'username':args.username,'password':password})
    result=post('/fab-data/runs',packet,login['csrf'])
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
