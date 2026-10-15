/** @returns 使用原图标／应用字体的首次欢迎页；不读取或改动业务数据。 */
export function FirstLaunchIntro() {
  return (
    <section className="first-launch-intro" aria-label="首次启动欢迎页">
      <div className="intro-brand">
        <img src="icon.png" alt="" />
        <h1>COC 跑团记录簿</h1>
        <p className="intro-modules">跑团记录·调查员</p>
        <p className="intro-slogan">记录每一次探索</p>
      </div>
      <p className="intro-creator">应用制作：亦如长风万里沙</p>
    </section>
  )
}
