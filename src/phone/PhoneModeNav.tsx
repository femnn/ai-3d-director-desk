type PhoneMode = "camera" | "pose" | "mocap";

export function PhoneModeNav({ active }: { active: PhoneMode }) {
  return (
    <nav className="phone-mode-nav" aria-label="手机功能切换">
      <a className={active === "camera" ? "is-active" : undefined} href="/phone?mode=standard">摄影机</a>
      <a className={active === "pose" ? "is-active" : undefined} href="/phone?mode=pose">骨骼编辑</a>
    </nav>
  );
}
