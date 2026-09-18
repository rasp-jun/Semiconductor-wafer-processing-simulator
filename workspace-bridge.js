/* Open an immutable review revision in the visual simulator; save edits explicitly as a new draft. */
(function(){
  'use strict';
  const revisionId=new URLSearchParams(location.search).get('revision');
  if(!revisionId)return;
  const banner=document.createElement('aside');banner.className='workspace-revision-banner';banner.setAttribute('role','status');
  const message=document.createElement('p');message.textContent='워크스페이스 레시피를 불러오고 있습니다.';banner.append(message);
  document.querySelector('#page-lab').prepend(banner);
  (async()=>{
    try{
      const response=await fetch('/api/revisions/'+encodeURIComponent(revisionId),{credentials:'same-origin'}),r=await response.json();
      if(!response.ok)throw new Error(r.error||'검토 버전을 불러오지 못했습니다.');
      window.WaferAppBridge.loadRecipe({params:r.params,scenario:r.scenario,reason:r.change_reason});
      message.textContent=r.recipe_name+' · r'+r.number+' · 서버에 저장된 조건을 불러왔습니다. 이 화면의 편집은 새 변경안으로 저장할 수 있습니다.';
      const meResponse=await fetch('/api/me',{credentials:'same-origin'});if(!meResponse.ok)throw new Error('세션을 확인할 수 없습니다.');const me=await meResponse.json();
      const button=document.createElement('button');button.hidden=!['admin','engineer'].includes(me.user.role);button.className='button primary';button.textContent='현재 조건으로 변경안 작성 ↗';
      button.addEventListener('click',()=>{try{sessionStorage.setItem('wf-review-draft',JSON.stringify({projectId:r.project_id,baseId:r.id,params:window.WaferAppBridge.snapshot().params}));location.href='workbench.html';}catch{message.textContent='브라우저의 임시 저장소를 사용할 수 없습니다. 워크스페이스에서 새 버전을 작성하세요.';}});banner.append(button);
      const link=document.createElement('a');link.href='workbench.html';link.className='button secondary';link.textContent='검토 워크스페이스';banner.append(link);
    }catch(error){message.textContent=error.message+' 워크스페이스에 로그인한 뒤 다시 열어주세요.';}
  })();
})();
