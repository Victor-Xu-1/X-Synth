import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';

function tourFactory() {
  return new Shepherd.Tour({
    defaultStepOptions: {
      cancelIcon: {
        enabled: true,
      },
      buttons: [
        {
          text: '上一步',
          action() {
            return this.back();
          },
        },
        {
          text: '下一步',
          action() {
            return this.next();
          },
        },
      ],
    },
    steps: [
      {
        title: '交互式路线规划',
        text: '该引导会说明交互式逆合成页面的主要区域：目标输入、一步预测、路线树构建、网络画布和节点详情。',
        buttons: [
          {
            text: '结束引导',
            action() {
              return this.cancel();
            },
            secondary: true,
          },
          {
            text: '下一步',
            action() {
              return this.next();
            },
          },
        ],
      },
      {
        title: '输入目标结构',
        text: '在这里输入目标分子的 SMILES。若名称解析服务已启用，也可以输入化学名称；关闭名称解析后，系统只接受 SMILES。',
        attachTo: {
          element: '#target',
          on: 'bottom',
        },
      },
      {
        title: '运行一步逆合成',
        text: '点击“一步逆合成”后，系统会调用当前策略中的逆合成模型，生成候选反应和前体。',
        attachTo: {
          element: '#expand-btn',
          on: 'bottom',
        },
      },
      {
        title: '查看网络画布',
        text: '预测结果会显示在网络画布中。目标分子、反应节点和前体节点会按路线状态着色，绿色通常表示可采购命中，红色表示未命中可采购数据库。',
        attachTo: {
          element: '#network',
          on: 'right',
        },
      },
      {
        title: '节点详情',
        text: '选择画布中的节点后，右侧会显示该结构或反应的详细信息。化学节点可继续展开，反应节点可查看评分、模板和参考反应信息。',
        attachTo: {
          element: '#details',
          on: 'left',
        },
      },
      {
        title: '展开节点',
        text: '对终端化学节点执行“展开节点”可继续递归预测前体。多次展开的结果会合并并去重，再按当前策略排序。',
        attachTo: {
          element: '#expand-btn-side',
          on: 'top',
        },
      },
      {
        title: '添加自定义前体',
        text: '可以手动添加候选前体。该操作只把结构加入当前网络，系统不会自动判断该自定义前体是否构成合理反应。',
        attachTo: {
          element: '#add-precursor-btn',
          on: 'top',
        },
      },
      {
        title: '推荐模板',
        text: '推荐模板弹窗会展示模型推荐的模板，包括未成功应用到目标结构的模板。该信息可用于排查模板匹配失败原因。',
        attachTo: {
          element: '#view-rec-templates-btn',
          on: 'top',
        },
      },
      {
        title: '禁用结构或反应',
        text: '禁用按钮可将不希望再次出现的化合物或反应加入禁用列表。禁用记录可在“禁用列表”页面管理。',
        attachTo: {
          element: '#ban-chemical-btn',
          on: 'top',
        },
      },
      {
        title: '排序与聚类',
        text: '前体建议可以按评分、复杂度、示例数量等指标排序。开启聚类后，相似前体会被折叠成代表性结果，便于浏览差异更大的路线。',
        attachTo: {
          element: '#details',
          on: 'left',
        },
      },
      {
        title: '构建路线树',
        text: '点击“构建路线树”会提交异步路线树任务。任务完成后可在“我的结果”页面查看和复用。',
        attachTo: {
          element: '#tb-submit',
          on: 'bottom',
        },
      },
      {
        title: '策略设置',
        text: '策略设置用于控制模型、模板数量、累计概率、可采购来源、聚类方式和图谱显示方式。修改后会影响后续预测和路线树任务。',
        attachTo: {
          element: '#tb-submit-settings',
          on: 'bottom',
        },
      },
      {
        title: '保存与导入结果',
        text: '登录后可保存当前网络到“我的结果”。也可以下载网络 JSON，并在之后导入恢复同一网络。',
        attachTo: {
          element: '#toolbar-bottom',
          on: 'bottom',
        },
      },
      {
        title: '引导结束',
        text: '你可以更换目标结构、调整策略或继续展开节点来构建自己的路线网络。',
        buttons: [
          {
            text: '上一步',
            action() {
              return this.back();
            },
          },
          {
            text: '完成',
            action() {
              return this.cancel();
            },
          },
        ],
      },
    ],
  });
}

export { tourFactory };
