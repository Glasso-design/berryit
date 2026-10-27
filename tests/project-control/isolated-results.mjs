// Execution success does not imply that a blocked verification gate passed.
export function isolatedResultSummary(results){
 if(!Array.isArray(results)||!results.length||results.some(r=>!['PASS','FAIL','BLOCKED'].includes(r?.status)))throw Error('VALID_TEST_RESULTS_REQUIRED');
 const count=status=>results.filter(r=>r.status===status).length;
 const passed=count('PASS'),failed=count('FAIL'),blocked=count('BLOCKED');
 return {passed,failed,blocked,status:failed?'FAIL':blocked?'BLOCKED':'PASS',exitCode:failed?1:blocked?2:0};
}
