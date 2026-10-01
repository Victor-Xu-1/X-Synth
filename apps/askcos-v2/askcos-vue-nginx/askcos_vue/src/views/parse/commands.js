export const commands = {
  home: {
    name: "工作台",
    path: "/",
    params: ["smiles"],
  },
  status: {
    name: "服务状态",
    path: "/status",
  },
  ipp: {
    name: "交互式路线规划",
    path: "/network",
    tab: "IPP",
    params: ["smiles"],
  },
  retro: {
    name: "一步逆合成预测",
    path: "/network",
    tab: "RP",
    params: ["smiles"],
  },
};
