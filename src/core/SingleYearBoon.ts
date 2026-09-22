/**
 * 单岁护航造化系统 (Single-Year Boons - V11)
 * 
 * 渡劫成功后展示 3 选 1 护航机缘，仅在即将到来的单岁有效。
 * 新岁末渡劫核验时自然注销复位（严格防止跨年累加滚雪球）。
 */

export type ActiveBoonId = 'xumi' | 'taiyi' | 'qitian';
export type SingleYearBoonId = ActiveBoonId | 'none';

export interface SingleYearBoon {
  id: ActiveBoonId;
  name: string;
  shortDesc: string;
  description: string;
}

export const SINGLE_YEAR_BOONS: Record<ActiveBoonId, SingleYearBoon> = {
  xumi: {
    id: 'xumi',
    name: '须弥芥子',
    shortDesc: '地脉扩至3格',
    description: '开拓地脉洞天，当岁地脉容量扩至 3 格（潜伏避灾与跨季三合蓄势更从容）。到期缩槽平滑触发软超限。',
  },
  taiyi: {
    id: 'taiyi',
    name: '太乙金丹',
    shortDesc: '神识130/回神+5',
    description: '太乙金丹固本培元，当岁神识上限提至 130 点，每轮周天运转额外回复 5 点神识。',
  },
  qitian: {
    id: 'qitian',
    name: '欺天灵符',
    shortDesc: '天劫门槛-20%',
    description: '瞒天过海偷换天机，当岁岁末天劫大考门槛直接减免 20%（渡劫压力骤降）。',
  },
};
