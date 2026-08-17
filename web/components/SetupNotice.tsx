export default function SetupNotice() {
  return (
    <div className="state" style={{ marginTop: 24 }}>
      <div className="plate">SETUP</div>
      <div className="state__t">아직 Supabase에 연결되지 않았습니다</div>
      <div className="state__d">
        <code>web/.env.local</code> 에 <code>SUPABASE_URL</code> 과{" "}
        <code>SUPABASE_SERVICE_ROLE_KEY</code> 를 넣고, <code>db/schema.sql</code> 을
        Supabase SQL Editor에서 실행한 뒤 배치를 돌리면 데이터가 채워집니다.
        자세한 절차는 프로젝트 README를 참고하세요.
      </div>
    </div>
  );
}
