import type { AnalysisRuleInput } from "./yuhun-decision.js";

export const BUILTIN_PRESET_ID = "builtin-high-standard-v1";

// Public filter conditions only. No account identifier or original share code.
const RULES: AnalysisRuleInput[] = [
  {
    "id": "builtin-high-standard-v1-discard-1",
    "pool": "discard",
    "label": "不带速度暴爆伤",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "crit",
          "requirement": "exclude"
        },
        {
          "stat": "critDamage",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-2",
    "pool": "discard",
    "label": "不带速暴攻加带爆伤",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "attackPercent",
          "requirement": "exclude"
        },
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "crit",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-3",
    "pool": "discard",
    "label": "不带速爆伤带暴击",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "attackPercent",
          "requirement": "exclude"
        },
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "critDamage",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-4",
    "pool": "discard",
    "label": "二三条副属性",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [],
      "subStatCounts": [
        "2",
        "3"
      ],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-5",
    "pool": "discard",
    "label": "二号防御加成",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        2
      ],
      "stars": [],
      "mainStats": [
        "defensePercent"
      ],
      "subStats": [],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-6",
    "pool": "discard",
    "label": "四六防御不带速度",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        4,
        6
      ],
      "stars": [],
      "mainStats": [
        "defensePercent"
      ],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-7",
    "pool": "discard",
    "label": "二号攻生不带暴生",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        2
      ],
      "stars": [],
      "mainStats": [
        "attackPercent",
        "hpPercent"
      ],
      "subStats": [
        {
          "stat": "hpPercent",
          "requirement": "exclude"
        },
        {
          "stat": "crit",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-8",
    "pool": "discard",
    "label": "六号攻生不带速暴",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        6
      ],
      "stars": [],
      "mainStats": [
        "attackPercent",
        "hpPercent"
      ],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "crit",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-9",
    "pool": "discard",
    "label": "招财不带速暴",
    "criteria": {
      "types": [
        "招财猫"
      ],
      "typeIds": [
        300010
      ],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "crit",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-10",
    "pool": "discard",
    "label": "招财不带速爆伤",
    "criteria": {
      "types": [
        "招财猫"
      ],
      "typeIds": [
        300010
      ],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "critDamage",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-11",
    "pool": "discard",
    "label": "不带速度不常用御魂",
    "criteria": {
      "types": [
        "蝠翼",
        "涅槃火",
        "被服",
        "镜姬",
        "幽谷响",
        "恶楼"
      ],
      "typeIds": [
        300004,
        300006,
        300009,
        300014,
        300049,
        300081
      ],
      "positions": [],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-discard-12",
    "pool": "discard",
    "label": "四号攻生不带速暴",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        4
      ],
      "stars": [],
      "mainStats": [
        "attackPercent",
        "hpPercent"
      ],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "exclude"
        },
        {
          "stat": "crit",
          "requirement": "exclude"
        }
      ],
      "subStatCounts": [],
      "levelRanges": [
        "0-2",
        "3-5",
        "6-8",
        "9-11",
        "12-14"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-enhance-1",
    "pool": "enhance",
    "label": "二号双速",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        2
      ],
      "stars": [],
      "mainStats": [
        "speed"
      ],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "include"
        }
      ],
      "subStatCounts": [
        "4"
      ],
      "levelRanges": [
        "0-2"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-enhance-2",
    "pool": "enhance",
    "label": "四条速度",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        1,
        3,
        4,
        5,
        6
      ],
      "stars": [],
      "mainStats": [],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "include"
        }
      ],
      "subStatCounts": [
        "4"
      ],
      "levelRanges": [
        "0-2"
      ],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-enhance-3",
    "pool": "enhance",
    "label": "四条防御防御加成",
    "criteria": {
      "types": [
        "招财猫",
        "反枕",
        "日女巳时",
        "珍珠",
        "魅妖",
        "木魅",
        "出世螺"
      ],
      "typeIds": [
        300010,
        300011,
        300013,
        300032,
        300035,
        300023,
        300084
      ],
      "positions": [
        2,
        4,
        6
      ],
      "stars": [],
      "mainStats": [
        "defensePercent"
      ],
      "subStats": [
        {
          "stat": "defense",
          "requirement": "include"
        },
        {
          "stat": "defensePercent",
          "requirement": "include"
        }
      ],
      "subStatCounts": [
        "4"
      ],
      "levelRanges": [],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-enhance-4",
    "pool": "enhance",
    "label": "二号双速三条",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        2
      ],
      "stars": [],
      "mainStats": [
        "speed"
      ],
      "subStats": [
        {
          "stat": "speed",
          "requirement": "include"
        }
      ],
      "subStatCounts": [
        "3",
        "4"
      ],
      "levelRanges": [],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-enhance-5",
    "pool": "enhance",
    "label": "四号命带命中三四条",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        4
      ],
      "stars": [],
      "mainStats": [
        "effectHit"
      ],
      "subStats": [
        {
          "stat": "effectHit",
          "requirement": "include"
        }
      ],
      "subStatCounts": [
        "3",
        "4"
      ],
      "levelRanges": [],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  },
  {
    "id": "builtin-high-standard-v1-enhance-6",
    "pool": "enhance",
    "label": "六号爆伤带暴击",
    "criteria": {
      "types": [],
      "typeIds": [],
      "positions": [
        6
      ],
      "stars": [],
      "mainStats": [
        "critDamage"
      ],
      "subStats": [
        {
          "stat": "crit",
          "requirement": "include"
        }
      ],
      "subStatCounts": [
        "4"
      ],
      "levelRanges": [],
      "intrinsicStats": [],
      "unknownTypeBits": [],
      "unknownOptionBits": []
    }
  }
];

export function createBuiltinPresetRules(): AnalysisRuleInput[] {
  return JSON.parse(JSON.stringify(RULES)) as AnalysisRuleInput[];
}
