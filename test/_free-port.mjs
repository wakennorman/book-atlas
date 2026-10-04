// 借一个空闲端口给无头浏览器的 CDP（--remote-debugging-port）用。
//
// 为什么需要它（v0.97，踩过的坑）：
//   写死端口的代价不是"偶尔冲突"，而是**失败点错了地方**——
//   上一次运行被强杀后残留的 Edge 还占着端口，下一次跑会在
//   `server.listen` 处 0 秒崩掉（EADDRINUSE），报错完全看不出"是上一次留下的"，
//   而且**断言一条都没跑**。实测 roam 连挂三次，背景与前台都一样。
//   这和用户报"页脚没版本号"是同一族问题：都是上一次的状态漏到了这一次。
//
// 为什么是"借一个再关掉"而不是别的办法：
//   Edge 要求在 spawn **之前**就知道端口号（命令行参数），没法用 0 让它自己选
//   （--remote-debugging-port=0 会让它把真实端口写进
//   <user-data-dir>/DevToolsActivePort，那条路要改 14 个文件的取值方式，
//   收益不抵风险）。所以这里向系统借：bind(0) 拿到一个当前没人用的端口就关掉。
//
// ⚠ 残留的竞态窗口：借到端口之后、Edge 抢占之前，理论上别的进程可能插进来。
//   这个窗口是毫秒级，实测 15 个测试连跑 + 门禁 26 步串行都没碰上。
//   真撞上了的表现是"CDP 连接超时"，而不是断言失败 —— 看到那种超时先查端口。
import net from 'node:net';

export const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

/** 借一个"成对"的端口：返回 [a, b]，b = a+1，方便 HTTP 与 CDP 分开用。
 *  ⚠ 借用后 b 并没有被"占用"，所以别指望它一定可用；这里只是省掉算术。 */
export const freePortPair = async () => {
  const a = await freePort();
  return [a, a + 1];
};