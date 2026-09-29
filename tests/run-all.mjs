import {runCmosReviewTests} from './cmos-review-core.test.mjs';
import {runCmosReviewExamplesTests} from './cmos-review-examples.test.mjs';
import {runCmosWindowTests} from './cmos-window-core.test.mjs';
import {runFabObserveTests} from './fab-observe-tests.mjs';
import {runFabDepositionTests} from './fab-deposition-tests.mjs';
import {runFabEtchLimitTests} from './fab-etch-limit-tests.mjs';
import {runFabMotionTests} from './fab-motion-tests.mjs';
import {runFabStorageTests} from './fab-storage-tests.mjs';
import {runFabPilotTests} from './fab-pilot-tests.mjs';
import {runPublicStudyTests} from './public-study-tests.mjs';
import {runWorkspaceBridgeTests} from './workspace-bridge-tests.mjs';
import {runPhotoMachineRenderTests} from './photo-machine-render-tests.mjs';
// Node 22+; no npm dependencies. HTTP workflow suites require their separate temporary server.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runTests} from './run-tests.mjs';
import {runFabTests} from './fab-tests.mjs';
import {runEquipmentEngineTests} from './equipment-engine-tests.mjs';
import {runEquipmentUITests} from './equipment-ui-tests.mjs';
import {runEquipmentReviewTests} from './equipment-review-tests.mjs';
import {runMemoryFabTests} from './memory-fab-tests.mjs';
import {runMemoryFabSceneTests} from './memory-fab-scene-tests.mjs';
import {runFabDataTests} from './fab-data-tests.mjs';
import {runFabDataAsyncTests} from './fab-data-async-tests.mjs';
import {runEvidenceTests} from './evidence-tests.mjs';

export async function runAll(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
  const suites=[['CMOS review',runCmosReviewTests],['CMOS review examples',runCmosReviewExamplesTests],['CMOS storage',runFabStorageTests],['CMOS motion',runFabMotionTests],['CMOS observation',runFabObserveTests],['CMOS deposition',runFabDepositionTests],['fab pilot',runFabPilotTests],['public equipment study',runPublicStudyTests],['fab data',runFabDataTests],['fab data async',runFabDataAsyncTests],['photo',runTests],['photo render',runPhotoMachineRenderTests],['workspace bridge',runWorkspaceBridgeTests],['CMOS',runFabTests],['equipment engine',runEquipmentEngineTests],['equipment UI',runEquipmentUITests],['equipment review',runEquipmentReviewTests],['memory fab',runMemoryFabTests],['memory scenes',runMemoryFabSceneTests],['model evidence',runEvidenceTests]];
  suites.splice(4,0,['CMOS etch limit',runFabEtchLimitTests]);
  suites.push(['CMOS process window',runCmosWindowTests]);
  let passed=0;const results=[];for(const[name,run]of suites){const result=await run(root);if(result.failed||result.tests?.some(t=>t.status==='failed'))throw Error(name+': '+JSON.stringify(result.tests.filter(t=>t.status==='failed')));passed+=result.passed;results.push({suite:name,passed:result.passed});}return{passed,suites:results};
}
if(typeof process!=='undefined'&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){runAll().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});}
