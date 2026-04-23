import { Link } from "react-router-dom";
import { Panel } from "../../shared/ui/Panel";

export function FamilyHomePage() {
  return (
    <div className="space-y-6">
      <Panel title="家屬互動頁已停用">
        <div className="space-y-4 text-sm text-slate-600">
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            目前已先停用所有會傳訊息給家屬的功能，因此家屬互動頁、表單與外部回寫流程暫不開放。
          </p>
          <p>
            若之後要恢復，會再以新的需求重新整理家屬互動流程；本階段先保留頁面路由，避免既有連結直接失效。
          </p>
        </div>
      </Panel>
    </div>
  );
}

export function FamilyVisitsPage() {
  return (
    <Panel title="家屬互動頁已停用">
      <p className="text-sm text-slate-600">
        目前已先停用所有家屬訊息功能，這裡暫不提供訪視列表與互動入口。
      </p>
      <Link
        to="/chat/family/home"
        className="mt-4 inline-flex rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
      >
        回到停用說明
      </Link>
    </Panel>
  );
}

export function FamilyMessagesPage() {
  return (
    <Panel title="家屬互動頁已停用">
      <p className="text-sm text-slate-600">
        目前已先停用所有家屬訊息功能，這裡暫不提供訊息箱與回覆入口。
      </p>
      <Link
        to="/chat/family/home"
        className="mt-4 inline-flex rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
      >
        回到停用說明
      </Link>
    </Panel>
  );
}
