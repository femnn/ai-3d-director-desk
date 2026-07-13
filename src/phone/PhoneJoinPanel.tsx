import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";

interface SessionInfo {
  desktopUrl: string;
  phoneUrl: string | null;
  localPhoneUrl: string;
  tunnelStatus?: "connecting" | "ready" | "unavailable";
}

export function PhoneJoinPanel() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const loadSession = () => {
      fetch("/api/session")
        .then((response) => response.json())
        .then((payload: SessionInfo) => {
          if (!stopped) setSession(payload);
        })
        .catch(() => {
          if (!stopped) setSession(null);
        });
    };
    loadSession();
    const interval = window.setInterval(loadSession, 1200);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [open]);

  return (
    <>
      <button
        className="top-bar-action-button"
        type="button"
        aria-label="手机扫码加入"
        title="手机扫码加入"
        onClick={() => setOpen(true)}
      >
        <Smartphone aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="phone-join-panel" role="dialog" aria-label="手机扫码加入控制台">
          <div className="agent-panel-header">
            <div>
              <h2>手机扫码加入</h2>
              <p>体感控制和手机骨骼编辑使用安全 HTTPS。</p>
            </div>
            <button type="button" aria-label="关闭手机扫码加入" onClick={() => setOpen(false)}>
              <X aria-hidden="true" size={16} />
            </button>
          </div>
          {session?.localPhoneUrl ? (
            <div className="phone-join-options">
              <section className="phone-join-option">
                <div className="phone-join-qr">
                  <img
                    alt="普通手机控制二维码"
                    src="/api/phone-qr.svg?mode=standard"
                  />
                </div>
                <div className="phone-join-info">
                  <span>普通局域网控制（无体感）</span>
                  <code>{session.localPhoneUrl}</code>
                </div>
              </section>
              <section className="phone-join-option">
                {session.phoneUrl ? (
                  <>
                    <div className="phone-join-qr">
                      <img alt="手机骨骼编辑二维码" src="/api/phone-qr.svg?mode=pose" />
                    </div>
                    <div className="phone-join-info">
                      <span>手机骨骼编辑（安全 HTTPS）</span>
                      <code>{session.phoneUrl.replace("mode=motion", "mode=pose")}</code>
                    </div>
                  </>
                ) : (
                  <div className="phone-join-info"><span>正在建立安全骨骼编辑连接...</span></div>
                )}
              </section>
              <section className="phone-join-option">
                {session.phoneUrl ? (
                  <>
                    <div className="phone-join-qr">
                      <img
                        alt="体感手机控制二维码"
                        src="/api/phone-qr.svg?mode=motion"
                      />
                    </div>
                    <div className="phone-join-info">
                      <span>体感控制（安全 HTTPS）</span>
                      <code>{session.phoneUrl}</code>
                    </div>
                  </>
                ) : (
                  <div className="phone-join-info">
                    <span>正在建立安全体感连接...</span>
                  </div>
                )}
              </section>
            </div>
          ) : session?.tunnelStatus === "unavailable" ? (
            <div className="phone-join-info">
              <span>手机连接未启动</span>
            </div>
          ) : (
            <p className="camera-animation-empty">正在读取手机控制地址...</p>
          )}
        </div>
      ) : null}
    </>
  );
}
