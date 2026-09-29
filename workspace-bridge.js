/* Open an immutable review revision in the visual simulator; save edits explicitly as a new draft. */
(function(){
  'use strict';
  const revisionId=new URLSearchParams(location.search).get('revision');
  if(!revisionId)return;
  const banner=document.createElement('aside');banner.className='workspace-revision-banner';banner.setAttribute('role','status');
  const message=document.createElement('p');message.textContent='워크스페이스 레시피를 불러오고 있습니다.';banner.append(message);
  document.querySelector('#page-lab').prepend(banner);
  const stamp=()=>{const state=window.WaferAppBridge.snapshot();return JSON.stringify({params:state.params,missionId:state.missionId,stageIndex:state.stageIndex,hypothesis:document.querySelector('#hypothesis').value,run:document.querySelector('#runLabel').textContent,page:document.querySelector('.page:not([hidden])')?.id,dialogs:[...document.querySelectorAll('dialog[open]')].map(dialog=>({id:dialog.id,fields:[...dialog.querySelectorAll('input,textarea,select')].map(field=>({name:field.id||field.name,value:field.value}))}))});};
  const initialStamp=stamp(),running=()=>document.body.classList.contains('running');
  (async()=>{
    try{
      const response=await fetch('/api/revisions/'+encodeURIComponent(revisionId),{credentials:'same-origin'}),r=await response.json();
      if(!response.ok)throw new Error(r.error||'검토 버전을 불러오지 못했습니다.');
      const applyButton=document.createElement('button');applyButton.id='workspaceApplyRecipe';applyButton.type='button';applyButton.className='button secondary';applyButton.textContent='서버 조건 불러오기';applyButton.hidden=true;banner.append(applyButton);
      const apply=()=>{
        if(running()){message.textContent='현재 공정을 계산하고 있습니다. 계산이 끝난 뒤 서버 조건을 불러오세요.';return;}
        if(document.querySelector('dialog[open]')){message.textContent='열린 대화상자의 작업을 마치거나 닫은 뒤 서버 조건을 불러오세요. 현재 입력은 유지됩니다.';return;}
        try{window.WaferAppBridge.loadRecipe({params:r.params,scenario:r.scenario,reason:r.change_reason});applyButton.hidden=true;message.textContent=r.recipe_name+' · r'+r.number+' · 서버에 저장된 조건을 불러왔습니다. 이 화면의 편집은 새 변경안으로 저장할 수 있습니다.';}
        catch(error){message.textContent=error.message;}
      };
      applyButton.addEventListener('click',apply);
      // A delayed request must not replace a newer draft, result, or selected view.
      if(!running()&&stamp()===initialStamp)apply();
      else{applyButton.hidden=false;message.textContent=r.recipe_name+' · r'+r.number+' · 기다리는 동안 변경한 입력과 선택을 보존했습니다. 서버 조건을 적용하려면 “서버 조건 불러오기”를 누르세요.';}
      const meResponse=await fetch('/api/me',{credentials:'same-origin'});if(!meResponse.ok)throw new Error('세션을 확인할 수 없습니다.');const me=await meResponse.json();
      const button=document.createElement('button');button.id='workspaceCreateDraft';button.type='button';button.hidden=!['admin','engineer'].includes(me.user.role);button.className='button primary';button.textContent='현재 조건으로 변경안 작성 ↗';
      button.addEventListener('click',()=>{
        const current=window.WaferAppBridge.snapshot();
        if(current.missionId!==r.scenario){applyButton.hidden=false;message.textContent='현재 선택한 과제가 서버 버전의 과제와 다릅니다. 서버 조건을 불러온 뒤 변경안을 작성하세요. 현재 입력은 유지됩니다.';return;}
        try{sessionStorage.setItem('wf-review-draft',JSON.stringify({projectId:r.project_id,baseId:r.id,params:current.params}));location.href='workbench.html';}
        catch{message.textContent='브라우저의 임시 저장소를 사용할 수 없습니다. 워크스페이스에서 새 버전을 작성하세요.';}
      });banner.append(button);
      const link=document.createElement('a');link.href='workbench.html';link.className='button secondary';link.textContent='검토 워크스페이스';banner.append(link);
    }catch(error){message.textContent=error.message+' 워크스페이스에 로그인한 뒤 다시 열어주세요.';}
  })();
})();
