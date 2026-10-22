/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RotateCcw,
  Settings,
  History,
  Download,
  AlertTriangle,
  HelpCircle,
  Trophy,
  CheckCircle2,
  XCircle,
  Plus,
  Minus,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  Sliders,
  X,
  RefreshCw,
  Sparkles,
  Info,
  BookOpen,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// =============================================================================
// 型定義 (Type Definitions)
// =============================================================================

export interface AppSettings {
  initialSequenceStr: string;   // 初期数字列の文字列 (カンマ区切り)
  unitAmount: number;            // 1単位の金額 (円、デフォルト100円)
  defaultPoints: number;         // 賭ける点数 (1〜20点、デフォルト1点)
  bankrollLimit: number;         // 資金上限 (警告しきい値、円)
  fixedBothEndsMode: boolean;    // 固定両端モード (ONなら配当に関係なく両端1個ずつ削除)
  autoRestartOnComplete: boolean;// サイクル完了時の自動再開ON/OFF
  allocationMode: 'exact' | 'uniform'; // 配分モード: 目標ぴったり配分(exact) | 均等切り上げ(uniform)
}

export type ResultType = 'hit' | 'miss';
export type UpdateActionType = 'both_dynamic' | 'both_2' | 'both_1' | 'right' | 'add' | 'miss';

export interface RaceRecord {
  id: string;
  raceNumber: number;            // 通算レース番号
  cycleNumber: number;           // サイクル番号
  sequenceBefore: number[];      // レース前の数字列
  sequenceAfter: number[];       // レース後の数字列
  unitsBet: number;              // 賭けた単位数 (指数)
  points: number;                // 賭けた点数
  perPointAmount: number;        // 1点あたり購入額
  actualTotal: number;           // 実際の購入合計額 (円)
  result: ResultType;            // 的中 (○) or 不的中 (×)
  payoutPer100: number;          // 100円あたりの配当 (円)
  winningBetAmount: number;      // 的中した点の購入額 (円)
  refund: number;                // 払戻金 (円)
  balance: number;               // 今回収支 (円)
  recoveryRate: number;          // 回収率・合成オッズ (倍率、例: 3.00)
  updateAction: UpdateActionType;// 数字列の更新種別
  eraseCountPerSide: number;     // 両端から消去した個数 (画像公式: 合成オッズ - 1)
  cycleCompleted: boolean;       // このレースでサイクル完了したか
  timestamp: string;             // 記録日時
}

interface UndoSnapshot {
  sequence: number[];
  cumulativeBalance: number;
  cycleBalance: number;
  raceCount: number;
  cycleCount: number;
  lossStreak: number;
  history: RaceRecord[];
  cycleCompletedNotice: { profit: number; cycleNum: number } | null;
}

// デフォルト設定値
const DEFAULT_SETTINGS: AppSettings = {
  initialSequenceStr: '1, 2, 3',
  unitAmount: 100,
  defaultPoints: 1, // デフォルト1点
  bankrollLimit: 50000,
  fixedBothEndsMode: false,
  autoRestartOnComplete: false,
  allocationMode: 'exact', // 目標賭け金にできるだけ合わせる「ぴったり配分」
};

const STORAGE_KEY = 'boatrace_monte_carlo_state_v2';

// =============================================================================
// 画像添付「モンテカルロ法の解説表」10レースの模範データ
// =============================================================================
export const SAMPLE_EXPLANATION_TABLE = [
  {
    race: 1,
    before: [1, 2, 3],
    index: 4,
    hit: '×',
    odds: '-',
    afterVisual: '1・2・3・4',
    after: [1, 2, 3, 4],
    bet: 400,
    refund: 0,
    balance: -400,
    action: 'miss',
  },
  {
    race: 2,
    before: [1, 2, 3, 4],
    index: 5,
    hit: '×',
    odds: '-',
    afterVisual: '1・2・3・4・5',
    after: [1, 2, 3, 4, 5],
    bet: 500,
    refund: 0,
    balance: -900,
    action: 'miss',
  },
  {
    race: 3,
    before: [1, 2, 3, 4, 5],
    index: 6,
    hit: '×',
    odds: '-',
    afterVisual: '1・2・3・4・5・6',
    after: [1, 2, 3, 4, 5, 6],
    bet: 600,
    refund: 0,
    balance: -1500,
    action: 'miss',
  },
  {
    race: 4,
    before: [1, 2, 3, 4, 5, 6],
    index: 7,
    hit: '×',
    odds: '-',
    afterVisual: '1・2・3・4・5・6・7',
    after: [1, 2, 3, 4, 5, 6, 7],
    bet: 700,
    refund: 0,
    balance: -2200,
    action: 'miss',
  },
  {
    race: 5,
    before: [1, 2, 3, 4, 5, 6, 7],
    index: 8,
    hit: '○',
    odds: '3倍',
    afterVisual: '~~1~~・~~2~~・3・4・5・~~6~~・~~7~~',
    after: [3, 4, 5],
    bet: 800,
    refund: 2400,
    balance: -600,
    action: 'both_2',
    note: '合成オッズ3倍 − 1 ＝ 両端2個ずつ消去！',
  },
  {
    race: 6,
    before: [3, 4, 5],
    index: 8,
    hit: '×',
    odds: '-',
    afterVisual: '3・4・5・8',
    after: [3, 4, 5, 8],
    bet: 800,
    refund: 0,
    balance: -1400,
    action: 'miss',
  },
  {
    race: 7,
    before: [3, 4, 5, 8],
    index: 11,
    hit: '×',
    odds: '-',
    afterVisual: '3・4・5・8・11',
    after: [3, 4, 5, 8, 11],
    bet: 1100,
    refund: 0,
    balance: -2500,
    action: 'miss',
  },
  {
    race: 8,
    before: [3, 4, 5, 8, 11],
    index: 14,
    hit: '○',
    odds: '2倍',
    afterVisual: '~~3~~・4・5・8・~~11~~',
    after: [4, 5, 8],
    bet: 1400,
    refund: 2800,
    balance: -1100,
    action: 'both_1',
    note: '合成オッズ2倍 − 1 ＝ 両端1個ずつ消去！',
  },
  {
    race: 9,
    before: [4, 5, 8],
    index: 12,
    hit: '×',
    odds: '-',
    afterVisual: '4・5・8・12',
    after: [4, 5, 8, 12],
    bet: 1200,
    refund: 0,
    balance: -2300,
    action: 'miss',
  },
  {
    race: 10,
    before: [4, 5, 8, 12],
    index: 16,
    hit: '○',
    odds: '3倍',
    afterVisual: '~~4~~・~~5~~・~~8~~・~~12~~ (完了)',
    after: [],
    bet: 1600,
    refund: 4800,
    balance: 900,
    action: 'both_2',
    note: '合成オッズ3倍 − 1 ＝ 両端2個消去でクリア！+¥900確定',
  },
];

// =============================================================================
// 独立した計算ロジック関数群 (添付画像「モンテカルロ法の解説表」完全準拠)
// =============================================================================

/**
 * 【計算ロジック1: 賭け金単位数(指数)算出】
 * 画像解説表の「指数」列の算出ロジック:
 * - 数字列の要素が2つ以上の場合: 「左端の数字 + 右端の数字」
 *   (例: [1, 2, 3] の場合 1 + 3 = 4、[3, 4, 5, 8, 11] の場合 3 + 11 = 14)
 * - 数字列の要素が1つの場合: 「その数字」
 * - 数字列が0個の場合: 0
 * 
 * @param sequence 現在の数字列配列
 * @returns 今回賭けるべき単位数 (指数)
 */
export function calculateBetUnits(sequence: number[]): number {
  if (!sequence || sequence.length === 0) {
    return 0;
  }
  if (sequence.length === 1) {
    return Math.max(1, sequence[0]);
  }
  const left = sequence[0];
  const right = sequence[sequence.length - 1];
  return Math.max(1, left + right);
}

/**
 * 【計算ロジック2: 点数配分と舟券購入金額算出】
 * 
 * ユーザー指定の柔軟な資金配分:
 * 例: 目標賭け金400円、賭ける点数3点の場合
 * - 「ぴったり配分(傾斜)」: 1点目200円、2点目100円、3点目100円 ➔ 購入合計 400円 (目標と完全一致！)
 * - 「均等切り上げ」: 各点200円 ➔ 購入合計 600円
 * 
 * @param units 賭け単位数 (指数)
 * @param unitAmount 基準額 (1単位の金額、デフォルト100円)
 * @param points 賭ける点数 (1〜20点)
 * @param allocationMode 'exact' (目標ぴったり配分/端数傾斜) | 'uniform' (均等切り上げ)
 * @returns 目標合計、各買い目の購入額配列(pointAmounts)、代表購入額(perPointAmount)、実際の購入合計(actualTotal)
 */
export function calculateBetAmounts(
  units: number,
  unitAmount: number,
  points: number,
  allocationMode: 'exact' | 'uniform' = 'exact'
): {
  targetTotal: number;
  perPointAmount: number;
  actualTotal: number;
  pointAmounts: number[];
} {
  const safePoints = Math.max(1, points);
  const targetTotal = Math.max(0, units * unitAmount);

  // 1. 均等切り上げ配分: 全点数を同じ切り上げ額で購入 (例: 400円/3点 ➔ 各200円、計600円)
  if (allocationMode === 'uniform') {
    const rawPerPoint = safePoints > 0 ? targetTotal / safePoints : 100;
    const perPointAmount = Math.max(100, Math.ceil(rawPerPoint / 100) * 100);
    const actualTotal = perPointAmount * safePoints;
    const pointAmounts = Array(safePoints).fill(perPointAmount);
    return {
      targetTotal,
      perPointAmount,
      actualTotal,
      pointAmounts,
    };
  }

  // 2. 目標ぴったり配分 (端数傾斜配分):
  // 舟券の最低単位は各点100円。
  // 目標金額が points * 100 未満の場合は最低額 (各100円) を配分。
  const minRequiredTotal = safePoints * 100;
  if (targetTotal <= minRequiredTotal) {
    const pointAmounts = Array(safePoints).fill(100);
    return {
      targetTotal,
      perPointAmount: 100,
      actualTotal: minRequiredTotal,
      pointAmounts,
    };
  }

  // 目標金額を100円単位で点数に割り振り、余りの100円単位を先頭(本命)から100円ずつ上乗せ。
  // 例: target=400円, 3点 ➔ 1点目200円, 2点目100円, 3点目100円 (計400円)
  // 例: target=500円, 3点 ➔ 1点目200円, 2点目200円, 3点目100円 (計500円)
  // 例: target=700円, 4点 ➔ 1点目200円, 2点目200円, 3点目200円, 4点目100円 (計700円)
  const totalHundreds = Math.round(targetTotal / 100);
  const baseHundreds = Math.floor(totalHundreds / safePoints);
  const remainderHundreds = totalHundreds % safePoints;

  const pointAmounts: number[] = [];
  for (let i = 0; i < safePoints; i++) {
    const hundreds = baseHundreds + (i < remainderHundreds ? 1 : 0);
    pointAmounts.push(Math.max(100, hundreds * 100));
  }

  const actualTotal = pointAmounts.reduce((sum, val) => sum + val, 0);
  const perPointAmount = pointAmounts[0]; // 代表購入額 (本命)

  return {
    targetTotal,
    perPointAmount,
    actualTotal,
    pointAmounts,
  };
}

/**
 * 【計算ロジック3: 必要オッズ算出 (オッズ連動ダイナミック消去対応)】
 * 1. 払い戻し ÷ 賭け金 ＝ 的中時オッズ
 * 2. 左右から消す数 ＝ 的中時オッズ − 1
 * 
 * - 4倍消去オッズ (左右から3個ずつ消去): (購入合計 × 4.0) ÷ 1点あたり購入額
 * - 3倍消去オッズ (左右から2個ずつ消去): (購入合計 × 3.0) ÷ 1点あたり購入額
 * - 2倍消去オッズ (左右から1個ずつ消去): (購入合計 × 2.0) ÷ 1点あたり購入額
 * - 損益分岐オッズ (回収率100%トントン): (購入合計 × 1.0) ÷ 1点あたり購入額
 */
export function calculateRequiredOdds(
  actualTotal: number,
  perPointAmount: number
): { odds4x: number; odds3x: number; odds2x: number; breakEvenOdds: number } {
  if (perPointAmount <= 0) {
    return { odds4x: 4.0, odds3x: 3.0, odds2x: 2.0, breakEvenOdds: 1.0 };
  }

  const odds4x = Number(((actualTotal * 4.0) / perPointAmount).toFixed(1));
  const odds3x = Number(((actualTotal * 3.0) / perPointAmount).toFixed(1));
  const odds2x = Number(((actualTotal * 2.0) / perPointAmount).toFixed(1));
  const breakEvenOdds = Number((actualTotal / perPointAmount).toFixed(1));

  return { odds4x, odds3x, odds2x, breakEvenOdds };
}

/**
 * 【計算ロジック4: 払戻金直接入力からの損益・的中時オッズ(回収率)算出】
 * ユーザー要望: 100円あたりの配当ではなく、払い戻し金額を入力。的中した買い目の購入金額はそのまま。
 * - 払戻金 = 入力された払い戻し金額 (円)
 * - 今回収支 = 払戻金 − 今回購入合計 (円)
 * - 的中時オッズ (recoveryRate) = 払戻金 ÷ 今回の賭け金(購入合計)
 * - 100円あたり換算配当 = 的中点購入額 > 0 ? floor((払戻金 ÷ 的中点購入額) × 100) : 0
 */
export function calculateFromRefund(
  refundAmount: number,
  winningBetAmount: number,
  actualTotal: number
): { refund: number; balance: number; recoveryRate: number; payoutPer100: number } {
  const refund = Math.max(0, refundAmount);
  const safeWinningBet = Math.max(1, winningBetAmount);
  const balance = refund - actualTotal;
  const recoveryRate = actualTotal > 0 ? Number((refund / actualTotal).toFixed(2)) : 0;
  const payoutPer100 = safeWinningBet > 0 ? Math.floor((refund / safeWinningBet) * 100) : 0;

  return {
    refund,
    balance,
    recoveryRate,
    payoutPer100,
  };
}

/**
 * 【計算ロジック4 (互換用): 100円あたり配当からの算出】
 */
export function calculatePayoutAndYield(
  payoutPer100: number,
  winningBetAmount: number,
  actualTotal: number
): { refund: number; balance: number; recoveryRate: number } {
  const safePayout = Math.max(0, payoutPer100);
  const safeWinningBet = Math.max(0, winningBetAmount);
  const refund = Math.floor((safePayout / 100) * safeWinningBet);
  const balance = refund - actualTotal;
  const recoveryRate = actualTotal > 0 ? Number((refund / actualTotal).toFixed(2)) : 0;

  return {
    refund,
    balance,
    recoveryRate,
  };
}

/**
 * 【計算ロジック5: 的中時の数字列更新 (オッズ連動ダイナミック消去)】
 * ユーザー指定の完全連動ルール:
 * 1. 払い戻し ÷ 賭け金 ＝ 的中時オッズ (recoveryRate)
 * 2. 左右から消す数 ＝ 的中時オッズ − 1 (切り捨て整数: Math.floor(odds) - 1)
 * 
 * - eraseCount = Math.floor(odds) - 1
 * - eraseCount >= 1 の場合:
 *     数式の左右両端から eraseCount 個ずつ消去 (合計 eraseCount * 2 個消去)
 *     例:
 *       的中時オッズ 2倍: 2 - 1 = 左右から1個ずつ (計2個消去)
 *       的中時オッズ 3倍: 3 - 1 = 左右から2個ずつ (計4個消去)
 *       的中時オッズ 4倍: 4 - 1 = 左右から3個ずつ (計6個消去)
 *       的中時オッズ 5倍: 5 - 1 = 左右から4個ずつ (計8個消去)
 *       的中時オッズ 10倍: 10 - 1 = 左右から9個ずつ (計18個消去)
 *     ※ 残りの数字列の長さ <= eraseCount * 2 の場合は、すべて消去されてサイクル完了 (空配列 [])
 *     ※ それ以外は: sequence.slice(eraseCount, sequence.length - eraseCount)
 * - 1.0 <= odds < 2.0 の場合 (1倍台・トントン〜微益):
 *     eraseCount = 0 ですが、赤字ではないため「右端のみ1個消去」して前進
 * - odds < 1.0 の場合 (トリガミ / 赤字):
 *     不的中と同様に「賭けた指数(単位数)」を数列の右端に追加
 */
export function getNextSequenceOnHit(
  sequence: number[],
  unitsBet: number,
  recoveryRate: number,
  fixedBothEndsMode: boolean = false
): {
  nextSequence: number[];
  updateAction: UpdateActionType;
  eraseCountPerSide: number;
  totalErasedCount: number;
  ruleTitle: string;
  explanation: string;
} {
  const seqCopy = [...sequence];

  // 固定モード: 常に両端1個ずつ消去
  if (fixedBothEndsMode) {
    if (seqCopy.length <= 2) {
      return {
        nextSequence: [],
        updateAction: 'both_1',
        eraseCountPerSide: 1,
        totalErasedCount: seqCopy.length,
        ruleTitle: '固定モード',
        explanation: '両端1個ずつ消去 (サイクル完了)',
      };
    }
    return {
      nextSequence: seqCopy.slice(1, -1),
      updateAction: 'both_1',
      eraseCountPerSide: 1,
      totalErasedCount: 2,
      ruleTitle: '固定モード',
      explanation: '両端1個ずつ消去',
    };
  }

  // 的中時オッズ (払い戻し ÷ 賭け金)
  const odds = recoveryRate;
  // ユーザー指定公式: 的中時オッズ - 1 の数を左右から消していく
  // 例: 2倍 -> 左右1個ずつ、3倍 -> 左右2個ずつ、4倍 -> 左右3個ずつ、5倍 -> 左右4個ずつ...
  const eraseCount = Math.max(0, Math.floor(odds) - 1);

  // 1. 的中時オッズ 2.0倍以上 (左右からそれぞれ eraseCount 個ずつ消去)
  if (eraseCount >= 1) {
    const totalErased = Math.min(seqCopy.length, eraseCount * 2);
    // 残りの数字列の長さが消去個数以下なら全消去でサイクル完了
    if (seqCopy.length <= eraseCount * 2) {
      return {
        nextSequence: [],
        updateAction: 'both_dynamic',
        eraseCountPerSide: eraseCount,
        totalErasedCount: totalErased,
        ruleTitle: `的中時オッズ ${odds.toFixed(1)}倍 (オッズ−1＝左右から各${eraseCount}個消去)`,
        explanation: `払戻÷賭金＝${odds.toFixed(2)}倍 ➔ 左右から各${eraseCount}個消去 (全消去・サイクル完了！)`,
      };
    }
    // 左右両端から eraseCount 個ずつ消去
    const nextSeq = seqCopy.slice(eraseCount, seqCopy.length - eraseCount);
    return {
      nextSequence: nextSeq,
      updateAction: 'both_dynamic',
      eraseCountPerSide: eraseCount,
      totalErasedCount: totalErased,
      ruleTitle: `的中時オッズ ${odds.toFixed(1)}倍 (オッズ−1＝左右から各${eraseCount}個消去)`,
      explanation: `払戻÷賭金＝${odds.toFixed(2)}倍 ➔ 左右から各${eraseCount}個消去 (計${totalErased}個消去)`,
    };
  }

  // 2. 的中時オッズ 1倍台 (1.0 <= odds < 2.0、回収率100%以上の微益)
  if (odds >= 1.0) {
    if (seqCopy.length <= 1) {
      return {
        nextSequence: [],
        updateAction: 'right',
        eraseCountPerSide: 0,
        totalErasedCount: 1,
        ruleTitle: `的中時オッズ ${odds.toFixed(1)}倍 (1倍台・微益)`,
        explanation: `的中時オッズ ${odds.toFixed(2)}倍: 右端のみ1個消去 (サイクル完了！)`,
      };
    }
    return {
      nextSequence: seqCopy.slice(0, -1),
      updateAction: 'right',
      eraseCountPerSide: 0,
      totalErasedCount: 1,
      ruleTitle: `的中時オッズ ${odds.toFixed(1)}倍 (1倍台・微益)`,
      explanation: `的中時オッズ ${odds.toFixed(2)}倍: 右端のみ1個消去`,
    };
  }

  // 3. 的中時オッズ 1.0倍未満 (トリガミ/赤字: 不的中と同様に今回賭けた指数を右端に追加)
  return {
    nextSequence: [...seqCopy, unitsBet],
    updateAction: 'add',
    eraseCountPerSide: 0,
    totalErasedCount: 0,
    ruleTitle: 'トリガミ (回収率1倍未満)',
    explanation: `的中時オッズ ${odds.toFixed(2)}倍: 赤字のため不的中と同様に右端に指数(+${unitsBet})を追加`,
  };
}

/**
 * 【計算ロジック6: 不的中時の数字列更新 (画像「終了後の数列」準拠)】
 * 不的中(×)時は、今回賭けた指数(単位数)を数列の右端に追加します。
 * (例: [1, 2, 3] で指数4 → [1, 2, 3, 4] になる)
 * 
 * @param sequence 現在の数字列
 * @param unitsBet 今回賭けた単位数 (指数)
 * @returns 更新後の数字列
 */
export function getNextSequenceOnMiss(sequence: number[], unitsBet: number): number[] {
  return [...sequence, unitsBet];
}

/**
 * 【計算ロジック7: 初期数字列パースと目標利益算出】
 * 
 * @param seqStr カンマ区切りの文字列
 * @param unitAmount 基準額 (1単位の金額)
 * @returns 数字配列と目標利益
 */
export function parseInitialSequence(
  seqStr: string,
  unitAmount: number
): { parsedSeq: number[]; targetProfit: number } {
  const parts = seqStr
    .split(/[,、\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);

  const parsedSeq = parts.length > 0 ? parts : [1, 2, 3];
  const targetProfit = parsedSeq.reduce((sum, val) => sum + val, 0) * unitAmount;

  return { parsedSeq, targetProfit };
}

// =============================================================================
// メインコンポーネント
// =============================================================================

export default function App() {
  // --- 設定ステート ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_settings`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.defaultPoints === 3) parsed.defaultPoints = 1; // 1点デフォルトへ移行
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {}
    return DEFAULT_SETTINGS;
  });

  const { parsedSeq: initialSeqArray, targetProfit: cycleTargetProfit } = useMemo(() => {
    return parseInitialSequence(settings.initialSequenceStr, settings.unitAmount);
  }, [settings.initialSequenceStr, settings.unitAmount]);

  // --- 進行ステート ---
  const [sequence, setSequence] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_sequence`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [1, 2, 3];
  });

  const [points, setPoints] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_points`);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 1) return parsed;
      }
    } catch {}
    return settings.defaultPoints || 1;
  });
  const [cumulativeBalance, setCumulativeBalance] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_cumBalance`);
      if (saved !== null) return Number(saved);
    } catch {}
    return 0;
  });

  const [cycleBalance, setCycleBalance] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_cycleBalance`);
      if (saved !== null) return Number(saved);
    } catch {}
    return 0;
  });

  const [raceCount, setRaceCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_raceCount`);
      if (saved !== null) return Number(saved);
    } catch {}
    return 0;
  });

  const [cycleCount, setCycleCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_cycleCount`);
      if (saved !== null) return Number(saved);
    } catch {}
    return 1;
  });

  const [lossStreak, setLossStreak] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_lossStreak`);
      if (saved !== null) return Number(saved);
    } catch {}
    return 0;
  });

  const [history, setHistory] = useState<RaceRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_history`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);

  // サイクル完了通知バナー
  const [cycleCompletedNotice, setCycleCompletedNotice] = useState<{
    profit: number;
    cycleNum: number;
  } | null>(null);

  // モーダルステート
  const [isHitModalOpen, setIsHitModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isExplanationTableOpen, setIsExplanationTableOpen] = useState(false); // 画像解説表モーダル
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // 的中モーダル入力
  const [hitRefundInput, setHitRefundInput] = useState<string>('1200');
  const [hitCustomWinningAmount, setHitCustomWinningAmount] = useState<string>('');
  const [selectedWinningPointIndex, setSelectedWinningPointIndex] = useState<number>(0);

  // 手動で各買い目の金額を微調整できるようにするステート（通常はnullで自動配分）
  const [customPointAmounts, setCustomPointAmounts] = useState<number[] | null>(null);
  // オッズ表示で対象とする点数のインデックス (0 = 1点目/本命)
  const [viewOddsPointIndex, setViewOddsPointIndex] = useState<number>(0);

  // 永続化
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY}_settings`, JSON.stringify(settings));
      localStorage.setItem(`${STORAGE_KEY}_sequence`, JSON.stringify(sequence));
      localStorage.setItem(`${STORAGE_KEY}_cumBalance`, String(cumulativeBalance));
      localStorage.setItem(`${STORAGE_KEY}_cycleBalance`, String(cycleBalance));
      localStorage.setItem(`${STORAGE_KEY}_raceCount`, String(raceCount));
      localStorage.setItem(`${STORAGE_KEY}_cycleCount`, String(cycleCount));
      localStorage.setItem(`${STORAGE_KEY}_lossStreak`, String(lossStreak));
      localStorage.setItem(`${STORAGE_KEY}_history`, JSON.stringify(history));
      localStorage.setItem(`${STORAGE_KEY}_points`, String(points));
    } catch {}
  }, [settings, sequence, cumulativeBalance, cycleBalance, raceCount, cycleCount, lossStreak, history, points]);

  // --- 計算値 ---
  const currentUnits = useMemo(() => calculateBetUnits(sequence), [sequence]);

  // 自動資金配分 (ぴったり配分: 目標400円/3点 ➔ 200+100+100=400円、または均等切り上げ)
  const autoAllocation = useMemo(() => {
    return calculateBetAmounts(
      currentUnits,
      settings.unitAmount,
      points,
      settings.allocationMode || 'exact'
    );
  }, [currentUnits, settings.unitAmount, points, settings.allocationMode]);

  // ユーザーが手動調整した各買い目の金額、または自動計算の金額
  const activePointAmounts = useMemo(() => {
    if (customPointAmounts && customPointAmounts.length === points) {
      return customPointAmounts;
    }
    return autoAllocation.pointAmounts;
  }, [customPointAmounts, points, autoAllocation.pointAmounts]);

  const targetTotal = autoAllocation.targetTotal;
  const actualTotal = useMemo(() => {
    return activePointAmounts.reduce((sum, v) => sum + v, 0);
  }, [activePointAmounts]);
  const perPointAmount = activePointAmounts[0] || 100;

  // 選択された買い目（または本命）基準の必要オッズ
  const targetBetForOdds = activePointAmounts[viewOddsPointIndex] || perPointAmount;
  const { odds4x, odds3x, odds2x, breakEvenOdds } = useMemo(() => {
    return calculateRequiredOdds(actualTotal, targetBetForOdds);
  }, [actualTotal, targetBetForOdds]);

  // 買い目金額の個別手動調整ハンドラー
  const handleAdjustPointAmount = (index: number, delta: number) => {
    const updated = [...activePointAmounts];
    updated[index] = Math.max(100, (updated[index] || 100) + delta);
    setCustomPointAmounts(updated);
  };
  const handleResetAllocation = () => {
    setCustomPointAmounts(null);
  };

  // レース統計
  const hitCount = useMemo(() => history.filter((r) => r.result === 'hit').length, [history]);
  const missCount = useMemo(() => history.filter((r) => r.result === 'miss').length, [history]);
  const winRate = useMemo(() => {
    return raceCount > 0 ? ((hitCount / raceCount) * 100).toFixed(1) : '0.0';
  }, [hitCount, raceCount]);
  const currentCycleRaces = useMemo(() => {
    return history.filter((r) => r.cycleNumber === cycleCount).length;
  }, [history, cycleCount]);

  // 資金上限警告
  const isBankrollWarning = useMemo(() => {
    if (settings.bankrollLimit <= 0) return false;
    return (
      actualTotal >= settings.bankrollLimit ||
      (cumulativeBalance < 0 && Math.abs(cumulativeBalance) + actualTotal >= settings.bankrollLimit)
    );
  }, [actualTotal, cumulativeBalance, settings.bankrollLimit]);

  // Undo Snapshot
  const saveSnapshot = useCallback(() => {
    const snapshot: UndoSnapshot = {
      sequence: [...sequence],
      cumulativeBalance,
      cycleBalance,
      raceCount,
      cycleCount,
      lossStreak,
      history: [...history],
      cycleCompletedNotice,
    };
    setUndoStack((prev) => [...prev.slice(-30), snapshot]);
  }, [sequence, cumulativeBalance, cycleBalance, raceCount, cycleCount, lossStreak, history, cycleCompletedNotice]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setSequence(last.sequence);
    setCumulativeBalance(last.cumulativeBalance);
    setCycleBalance(last.cycleBalance);
    setRaceCount(last.raceCount);
    setCycleCount(last.cycleCount);
    setLossStreak(last.lossStreak);
    setHistory(last.history);
    setCycleCompletedNotice(last.cycleCompletedNotice);
    setUndoStack((prev) => prev.slice(0, -1));
  }, [undoStack]);

  // 不的中 (×)
  const handleMiss = useCallback(() => {
    saveSnapshot();
    const nextSeq = getNextSequenceOnMiss(sequence, currentUnits);
    const newRaceCount = raceCount + 1;
    const newCumulative = cumulativeBalance - actualTotal;
    const newCycleBal = cycleBalance - actualTotal;
    const newLossStreak = lossStreak + 1;

    const record: RaceRecord = {
      id: `${Date.now()}-${newRaceCount}`,
      raceNumber: newRaceCount,
      cycleNumber: cycleCount,
      sequenceBefore: [...sequence],
      sequenceAfter: nextSeq,
      unitsBet: currentUnits,
      points,
      perPointAmount,
      actualTotal,
      result: 'miss',
      payoutPer100: 0,
      winningBetAmount: 0,
      refund: 0,
      balance: -actualTotal,
      recoveryRate: 0,
      updateAction: 'miss',
      eraseCountPerSide: 0,
      cycleCompleted: false,
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    setSequence(nextSeq);
    setRaceCount(newRaceCount);
    setCumulativeBalance(newCumulative);
    setCycleBalance(newCycleBal);
    setLossStreak(newLossStreak);
    setHistory((prev) => [record, ...prev]);
    setCustomPointAmounts(null);
    setViewOddsPointIndex(0);
  }, [saveSnapshot, sequence, currentUnits, raceCount, cumulativeBalance, actualTotal, cycleBalance, lossStreak, cycleCount, points, perPointAmount]);

  // 的中モーダルを開く
  const openHitModal = () => {
    // 3倍オッズ（左右各2個消去）相当の払戻金をデフォルト提案 (例: 400円なら1200円)
    const suggestedRefund = Math.max(100, actualTotal * 3);
    setHitRefundInput(String(suggestedRefund));
    setIsHitModalOpen(true);
  };

  // 的中試算プレビュー (画像公式: 払い戻し ÷ 賭け金 ＝ 的中時オッズ、オッズ - 1 ＝ 消去個数)
  const hitPreview = useMemo(() => {
    const refund = Math.max(0, parseInt(hitRefundInput, 10) || 0);
    const balance = refund - actualTotal;
    const recoveryRate = actualTotal > 0 ? Number((refund / actualTotal).toFixed(2)) : 0;
    const payoutPer100 = actualTotal > 0 ? Math.floor((refund / actualTotal) * 100) : 0;

    const {
      nextSequence,
      updateAction,
      eraseCountPerSide,
      totalErasedCount,
      ruleTitle,
      explanation,
    } = getNextSequenceOnHit(sequence, currentUnits, recoveryRate, settings.fixedBothEndsMode);

    const isCycleEnd = nextSequence.length <= 1;
    const nextUnits = isCycleEnd
      ? calculateBetUnits(initialSeqArray)
      : calculateBetUnits(nextSequence);
    const nextAmounts = calculateBetAmounts(
      nextUnits,
      settings.unitAmount,
      points,
      settings.allocationMode || 'exact'
    );

    return {
      payout: payoutPer100,
      payoutPer100,
      winningAmount: actualTotal,
      refund,
      balance,
      recoveryRate,
      updateAction,
      eraseCountPerSide,
      totalErasedCount,
      ruleTitle,
      explanation,
      nextSequence,
      isCycleEnd,
      nextUnits,
      nextTotal: nextAmounts.actualTotal,
    };
  }, [
    hitRefundInput,
    actualTotal,
    sequence,
    currentUnits,
    settings.fixedBothEndsMode,
    settings.unitAmount,
    settings.allocationMode,
    points,
    initialSeqArray,
  ]);

  // 的中確定
  const handleConfirmHit = () => {
    saveSnapshot();
    const {
      payout,
      winningAmount,
      refund,
      balance,
      recoveryRate,
      updateAction,
      eraseCountPerSide,
      nextSequence,
      isCycleEnd,
    } = hitPreview;

    const newRaceCount = raceCount + 1;
    const newCumulative = cumulativeBalance + balance;
    const newCycleBal = cycleBalance + balance;

    const record: RaceRecord = {
      id: `${Date.now()}-${newRaceCount}`,
      raceNumber: newRaceCount,
      cycleNumber: cycleCount,
      sequenceBefore: [...sequence],
      sequenceAfter: nextSequence,
      unitsBet: currentUnits,
      points,
      perPointAmount,
      actualTotal,
      result: 'hit',
      payoutPer100: payout,
      winningBetAmount: winningAmount,
      refund,
      balance,
      recoveryRate,
      updateAction,
      eraseCountPerSide,
      cycleCompleted: isCycleEnd,
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    setRaceCount(newRaceCount);
    setCumulativeBalance(newCumulative);
    setLossStreak(0);
    setHistory((prev) => [record, ...prev]);
    setIsHitModalOpen(false);

    if (isCycleEnd) {
      setCycleCompletedNotice({
        profit: newCycleBal,
        cycleNum: cycleCount,
      });

      if (settings.autoRestartOnComplete) {
        setSequence(initialSeqArray);
        setCycleCount((c) => c + 1);
        setCycleBalance(0);
      } else {
        setSequence(nextSequence);
      }
    } else {
      setSequence(nextSequence);
      setCycleBalance(newCycleBal);
    }
    setCustomPointAmounts(null);
    setViewOddsPointIndex(0);
  };

  const handleStartNextCycle = () => {
    saveSnapshot();
    setSequence(initialSeqArray);
    setCycleCount((c) => c + 1);
    setCycleBalance(0);
    setCycleCompletedNotice(null);
  };

  const handleResetAll = () => {
    saveSnapshot();
    setSequence(initialSeqArray);
    setCumulativeBalance(0);
    setCycleBalance(0);
    setRaceCount(0);
    setCycleCount(1);
    setLossStreak(0);
    setHistory([]);
    setCycleCompletedNotice(null);
    setIsResetConfirmOpen(false);
  };

  const handleResetCurrentCycle = () => {
    saveSnapshot();
    setSequence(initialSeqArray);
    setCycleBalance(0);
    setLossStreak(0);
    setCycleCompletedNotice(null);
    setIsResetConfirmOpen(false);
  };

  // CSVエクスポート
  const handleExportCSV = () => {
    if (history.length === 0) return;

    const headers = [
      'レース番号',
      'サイクル',
      '結果',
      '100円配当(円)',
      '的中点購入額(円)',
      '払戻金(円)',
      '投資合計(円)',
      '今回収支(円)',
      '合成オッズ',
      '更新内容',
      '変化前数列',
      '変化後数列',
      '日時',
    ];

    const rows = history.map((r) => [
      r.raceNumber,
      r.cycleNumber,
      r.result === 'hit' ? '的中(○)' : '不的中(×)',
      r.payoutPer100,
      r.winningBetAmount,
      r.refund,
      r.actualTotal,
      r.balance,
      r.recoveryRate.toFixed(2) + '倍',
      r.updateAction === 'both_2'
        ? '両端2個消去(3倍公式)'
        : r.updateAction === 'both_1'
        ? '両端1個消去(2倍公式)'
        : r.updateAction === 'right'
        ? '右端消去'
        : r.updateAction === 'add'
        ? '右端追加(トリガミ)'
        : '右端追加(不的中)',
      `"[${r.sequenceBefore.join(', ')}]"`,
      `"[${r.sequenceAfter.join(', ')}]"`,
      r.timestamp,
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    link.setAttribute('href', url);
    link.setAttribute('download', `boatrace_montecarlo_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // チップハイライト判定
  const getChipStyle = (index: number, totalLen: number) => {
    if (totalLen === 1) {
      return {
        badge: '単独',
        bg: 'bg-gradient-to-b from-cyan-500 to-blue-600 text-white shadow-cyan-500/30 ring-2 ring-cyan-300',
      };
    }
    if (index === 0) {
      return {
        badge: '左端',
        bg: 'bg-gradient-to-b from-cyan-500 to-cyan-700 text-white shadow-cyan-500/25 ring-2 ring-cyan-400',
      };
    }
    if (index === totalLen - 1) {
      return {
        badge: '右端',
        bg: 'bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-emerald-500/25 ring-2 ring-emerald-400',
      };
    }
    return {
      badge: '',
      bg: 'bg-slate-800/90 text-slate-300 border border-slate-700/80',
    };
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none pb-28">
      {/* ===================================================================== */}
      {/* 1. TOP APP BAR                                                        */}
      {/* ===================================================================== */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3 flex items-center justify-between">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-black text-white text-sm shadow-md shadow-cyan-500/20">
            舟
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>BOATRACE</span>
              <span className="text-[10px] font-semibold text-cyan-400 bg-cyan-950/80 border border-cyan-800 px-1.5 py-0.2 rounded">
                Monte Carlo
              </span>
            </h1>
            <p className="text-[10px] text-slate-400">モンテカルロ資金管理</p>
          </div>
        </div>

        {/* Zone 2: 実施レース数・サイクル表示 (常時表示) */}
        <div className="flex items-center gap-2 text-xs font-num">
          <div className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-inner">
            <span className="text-[10px] text-slate-400 font-sans">実施</span>
            <span className="font-bold text-cyan-400 text-sm font-num">{raceCount}</span>
            <span className="text-[10px] text-slate-400 font-sans">戦</span>
          </div>
          <div className="hidden xs:flex items-center gap-1 text-[11px] text-slate-400">
            <span className="text-slate-500">C</span>
            <span className="font-bold text-slate-200">#{cycleCount}</span>
          </div>
        </div>

        {/* Zone 3: Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="直前の操作を1つ戻す"
            className="h-9 px-2.5 rounded-lg border border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">戻す</span>
          </button>

          <button
            onClick={() => setIsExplanationTableOpen(true)}
            title="解説表を見る"
            className="h-9 px-2.5 rounded-lg border border-amber-800/80 bg-amber-950/30 text-amber-300 hover:text-white hover:bg-amber-900/50 flex items-center gap-1 text-xs transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden xs:inline">解説表</span>
          </button>

          <button
            onClick={() => setIsHistoryOpen(true)}
            title="履歴とCSV出力"
            className="h-9 px-2.5 rounded-lg border border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1 text-xs transition-colors"
          >
            <History className="w-3.5 h-3.5 text-cyan-400" />
            {history.length > 0 && (
              <span className="text-[10px] bg-slate-800 text-slate-300 px-1 rounded-full">
                {history.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            title="設定"
            className="h-9 w-9 rounded-lg border border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <Settings className="w-4 h-4 text-slate-300" />
          </button>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* 2. MAIN CONTAINER                                                     */}
      {/* ===================================================================== */}
      <main className="flex-1 max-w-xl w-full mx-auto px-3.5 pt-3 space-y-3.5">
        {/* 資金上限アラート */}
        {isBankrollWarning && (
          <div className="bg-rose-950/70 border border-rose-500/50 rounded-xl p-3 flex items-start gap-2.5 animate-pulse text-xs text-rose-200">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-rose-300">【資金上限警告】上限額に接近中</p>
              <p className="mt-0.5 text-rose-200/90">
                設定上限: ¥{settings.bankrollLimit.toLocaleString()} (今回購入: ¥{actualTotal.toLocaleString()} / 累計損益: ¥{cumulativeBalance.toLocaleString()})
              </p>
            </div>
          </div>
        )}

        {/* サイクル完了バナー */}
        <AnimatePresence>
          {cycleCompletedNotice && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-gradient-to-r from-emerald-950/90 via-cyan-950/90 to-blue-950/90 border border-emerald-500/60 rounded-2xl p-4 shadow-lg shadow-emerald-950/50"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center">
                    <Trophy className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-emerald-300 flex items-center gap-1.5">
                      <span>サイクル #{cycleCompletedNotice.cycleNum} 完了！</span>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                    </h2>
                    <p className="text-xs text-slate-300 mt-0.5">
                      利益確定:{' '}
                      <span className="font-bold font-num text-emerald-400 text-sm">
                        +¥{cycleCompletedNotice.profit.toLocaleString()}
                      </span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleStartNextCycle}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-md transition-transform active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>次のサイクル</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ------------------------------------------------------------------- */}
        {/* 実施レース数・ステータスインジケーター                               */}
        {/* ------------------------------------------------------------------- */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between text-xs shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center font-bold text-cyan-400 shrink-0">
              🏁
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-slate-400 font-semibold">通算実施レース数:</span>
                <span className="text-base font-black font-num text-cyan-300">
                  {raceCount} <span className="text-xs font-normal text-slate-400">戦</span>
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-num mt-0.5 flex items-center gap-2">
                <span>
                  的中 <strong className="text-emerald-400">{hitCount}</strong> / 不的中 <strong className="text-rose-400">{missCount}</strong>
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  勝率 <strong className="text-slate-200">{winRate}%</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="text-right pl-3 border-l border-slate-800 shrink-0">
            <div className="text-[10px] text-slate-500">サイクル #{cycleCount}</div>
            <div className="font-num font-bold text-xs text-slate-200 mt-0.5">
              第{currentCycleRaces + 1}戦目
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------- */}
        {/* カード1: 現在の数列 (Current Sequence & 指数)                        */}
        {/* ------------------------------------------------------------------- */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold tracking-wider text-slate-400">現在の数列</span>
              <span className="text-[11px] text-slate-500 font-num">
                (残 {sequence.length} 個)
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <span>目標利益:</span>
              <span className="font-bold font-num text-amber-400">
                +¥{cycleTargetProfit.toLocaleString()}
              </span>
            </div>
          </div>

          {/* チップ一覧表示 */}
          <div className="min-h-[76px] flex flex-wrap items-center justify-center gap-2 py-2 bg-slate-950/70 border border-slate-800/80 rounded-xl px-3">
            {sequence.length === 0 ? (
              <div className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>数字列クリア！サイクル完了しました</span>
              </div>
            ) : (
              sequence.map((num, idx) => {
                const style = getChipStyle(idx, sequence.length);
                return (
                  <motion.div
                    key={`${idx}-${num}-${sequence.length}`}
                    layout
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 450, damping: 25 }}
                    className="relative flex flex-col items-center"
                  >
                    {style.badge && (
                      <span className="text-[9px] font-bold tracking-tight text-slate-400 mb-0.5">
                        {style.badge}
                      </span>
                    )}
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center font-num text-base font-bold shadow-md ${style.bg}`}
                    >
                      {num}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* 賭け金単位 (指数) の計算根拠 */}
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">指数 (賭け単位数):</span>
              <span className="font-num text-slate-300">
                {sequence.length >= 2 ? (
                  <>
                    <span className="text-cyan-400 font-bold">{sequence[0]}</span> +{' '}
                    <span className="text-emerald-400 font-bold">{sequence[sequence.length - 1]}</span>
                  </>
                ) : sequence.length === 1 ? (
                  <span className="text-cyan-400 font-bold">{sequence[0]}</span>
                ) : (
                  <span>0</span>
                )}
                {' = '}
                <strong className="text-white text-sm font-bold">{currentUnits}</strong>
              </span>
            </div>

            <div className="text-[11px] text-slate-400">
              基準: <span className="font-num text-slate-200">¥{settings.unitAmount}</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------- */}
        {/* カード2: 賭金 & 舟券購入額                                          */}
        {/* ------------------------------------------------------------------- */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* 賭金合計 (指数 × 基準100円) */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 font-medium">賭金 (目標合計)</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-black font-num text-cyan-300 tracking-tight">
                  ¥{targetTotal.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-num">({currentUnits}指数)</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                指数{currentUnits} × 基準¥{settings.unitAmount}
              </div>
            </div>

            {/* 実際の舟券発券合計 */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
              <div className="text-[11px] text-slate-400 font-medium flex items-center justify-between">
                <span>実際の購入合計</span>
                {actualTotal === targetTotal ? (
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60">
                    目標一致
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-400 font-bold">
                    {actualTotal > targetTotal ? `+¥${actualTotal - targetTotal}` : `¥${actualTotal - targetTotal}`}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-black font-num text-white tracking-tight">
                  ¥{actualTotal.toLocaleString()}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1 truncate">
                {points === 1
                  ? `1点 ¥${actualTotal.toLocaleString()}`
                  : activePointAmounts.every((v) => v === activePointAmounts[0])
                  ? `各点 ¥${activePointAmounts[0]} × ${points}点`
                  : activePointAmounts.map((amt, idx) => `${idx === 0 ? '本命' : `${idx + 1}点目`}¥${amt}`).join(' + ')}
              </div>
            </div>
          </div>

          {/* 点数選択 & 配分モード切り替え */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] text-slate-400">賭ける点数</div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPointAmounts(null);
                      setViewOddsPointIndex(0);
                      setPoints((p) => Math.max(1, p - 1));
                    }}
                    className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center font-bold active:scale-95 transition-transform"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-9 text-center font-num font-bold text-lg text-white">
                    {points}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPointAmounts(null);
                      setViewOddsPointIndex(0);
                      setPoints((p) => Math.min(20, p + 1));
                    }}
                    className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center font-bold active:scale-95 transition-transform"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-slate-400">点</span>
                </div>
              </div>

              {/* クイック点数 */}
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 6].map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => {
                      setCustomPointAmounts(null);
                      setViewOddsPointIndex(0);
                      setPoints(pt);
                    }}
                    className={`h-7 px-2 text-xs font-bold rounded-md transition-colors ${
                      points === pt
                        ? 'bg-cyan-500 text-slate-950'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white'
                    }`}
                  >
                    {pt}点
                  </button>
                ))}
              </div>
            </div>

            {/* 配分モード切り替え (点数 > 1 の時) */}
            {points > 1 && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">配分モード:</span>
                <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setSettings((prev) => ({ ...prev, allocationMode: 'exact' }));
                      setCustomPointAmounts(null);
                    }}
                    className={`px-2.5 py-1 rounded font-bold transition-all ${
                      settings.allocationMode === 'exact'
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🎯 ぴったり配分
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSettings((prev) => ({ ...prev, allocationMode: 'uniform' }));
                      setCustomPointAmounts(null);
                    }}
                    className={`px-2.5 py-1 rounded font-bold transition-all ${
                      settings.allocationMode === 'uniform'
                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ⚖️ 均等切上
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 各買い目ごとの配分内訳と微調整 (点数 > 1 の時に表示) */}
          {points > 1 && (
            <div className="bg-slate-950/70 border border-slate-800/90 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300">
                  買い目ごとの購入額 (タップで±100円微調整可):
                </span>
                {customPointAmounts !== null && (
                  <button
                    type="button"
                    onClick={handleResetAllocation}
                    className="text-cyan-400 hover:underline text-[10px]"
                  >
                    ↩ 自動配分に戻す
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {activePointAmounts.map((amt, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded-lg border text-center transition-all ${
                      idx === 0
                        ? 'bg-cyan-950/20 border-cyan-800/60'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                      <span>{idx === 0 ? '🎯 1点目(本命)' : `${idx + 1}点目`}</span>
                    </div>
                    <div className="font-num font-bold text-base text-white my-1">
                      ¥{amt.toLocaleString()}
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAdjustPointAmount(idx, -100)}
                        disabled={amt <= 100}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 flex items-center justify-center font-bold text-xs"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustPointAmount(idx, 100)}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------------- */}
        {/* カード3: 必要オッズ (オッズ連動ダイナミック消去)                      */}
        {/* ------------------------------------------------------------------- */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>必要オッズ (消去条件)</span>
            </span>
            <span className="text-[10px] text-amber-400 font-num bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60 self-start sm:self-auto">
              払い戻し÷賭け金＝的中時オッズ（オッズ−1個を左右から消去）
            </span>
          </div>

          {/* 買い目別のオッズ切り替え (各点の金額が異なる場合) */}
          {points > 1 && !activePointAmounts.every((v) => v === activePointAmounts[0]) && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
              <span className="text-slate-400 text-[10px] shrink-0">基準買い目:</span>
              {activePointAmounts.map((amt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setViewOddsPointIndex(idx)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 transition-colors ${
                    viewOddsPointIndex === idx
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {idx === 0 ? '本命' : `${idx + 1}点目`} (¥{amt})
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {/* 2倍消去オッズ (左右1個ずつ消去) */}
            <div className="bg-slate-950/60 border border-cyan-500/40 rounded-xl p-2.5 text-center">
              <div className="text-[10px] font-bold text-cyan-400">
                2倍消去
              </div>
              <div className="text-[9px] text-cyan-300/80">
                左右1個ずつ消去
              </div>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-xl font-black font-num text-cyan-300">
                  {odds2x.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400">倍~</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">
                計2個消去
              </div>
            </div>

            {/* 3倍消去オッズ (左右2個ずつ消去) */}
            <div className="bg-slate-950/60 border border-emerald-500/40 rounded-xl p-2.5 text-center relative overflow-hidden">
              <div className="text-[10px] font-bold text-emerald-400">
                3倍消去
              </div>
              <div className="text-[9px] text-emerald-300/80">
                左右2個ずつ消去
              </div>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-xl font-black font-num text-emerald-300">
                  {odds3x.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400">倍~</span>
              </div>
              <div className="text-[9px] text-emerald-400 font-semibold mt-0.5">
                計4個消去
              </div>
            </div>

            {/* 4倍消去オッズ (左右3個ずつ消去) */}
            <div className="bg-slate-950/60 border border-purple-500/40 rounded-xl p-2.5 text-center">
              <div className="text-[10px] font-bold text-purple-400">
                4倍消去
              </div>
              <div className="text-[9px] text-purple-300/80">
                左右3個ずつ消去
              </div>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-xl font-black font-num text-purple-300">
                  {odds4x.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400">倍~</span>
              </div>
              <div className="text-[9px] text-purple-400 font-semibold mt-0.5">
                計6個消去
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1 border-t border-slate-800">
            <span>
              損益分岐オッズ (回収率100%): <strong className="font-num text-amber-400">{breakEvenOdds.toFixed(1)}倍</strong>
            </span>
            <span className="text-slate-400 text-[10px]">高オッズほど左右から多く消去</span>
          </div>
        </section>

        {/* ------------------------------------------------------------------- */}
        {/* カード4: 収支・進捗ダッシュボード                                    */}
        {/* ------------------------------------------------------------------- */}
        <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 shadow-sm">
          <div className="grid grid-cols-4 gap-2 text-center">
            {/* 累計収支 */}
            <div className="bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
              <div className="text-[10px] text-slate-400">累計収支</div>
              <div
                className={`font-num font-bold text-sm mt-0.5 ${
                  cumulativeBalance > 0
                    ? 'text-emerald-400'
                    : cumulativeBalance < 0
                    ? 'text-rose-400'
                    : 'text-slate-300'
                }`}
              >
                {cumulativeBalance > 0 ? '+' : ''}¥{cumulativeBalance.toLocaleString()}
              </div>
            </div>

            {/* サイクル収支 */}
            <div className="bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
              <div className="text-[10px] text-slate-400">サイクル収支</div>
              <div
                className={`font-num font-bold text-sm mt-0.5 ${
                  cycleBalance > 0
                    ? 'text-emerald-400'
                    : cycleBalance < 0
                    ? 'text-rose-400'
                    : 'text-slate-300'
                }`}
              >
                {cycleBalance > 0 ? '+' : ''}¥{cycleBalance.toLocaleString()}
              </div>
            </div>

            {/* 実施レース数 */}
            <div className="bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
              <div className="text-[10px] text-slate-400">実施レース数</div>
              <div className="font-num font-bold text-sm text-cyan-300 mt-0.5">
                {raceCount} <span className="text-[10px] text-slate-500 font-normal">戦</span>
              </div>
              <div className="text-[9px] text-slate-500 font-num">
                勝率 {winRate}%
              </div>
            </div>

            {/* 連敗数 */}
            <div className="bg-slate-950/50 rounded-xl p-2 border border-slate-800/60">
              <div className="text-[10px] text-slate-400">連敗数</div>
              <div
                className={`font-num font-bold text-sm mt-0.5 ${
                  lossStreak >= 4 ? 'text-rose-400 font-black' : 'text-slate-200'
                }`}
              >
                {lossStreak} <span className="text-[10px] text-slate-500 font-normal">連敗</span>
              </div>
            </div>
          </div>
        </section>

        {/* 下部ヘルパーリンク */}
        <div className="flex items-center justify-between text-xs text-slate-500 px-1 pt-1">
          <button
            type="button"
            onClick={() => setIsExplanationTableOpen(true)}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors font-medium"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>モンテカルロ法の解説表を見る</span>
          </button>

          <button
            type="button"
            onClick={() => setIsResetConfirmOpen(true)}
            className="flex items-center gap-1 text-slate-400 hover:text-rose-400 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>リセット</span>
          </button>
        </div>

        {/* 免責事項 */}
        <footer className="text-center text-[10px] text-slate-500 pt-2 pb-6 px-3 leading-relaxed">
          本アプリは資金管理の補助ツールであり、的中や利益を保証するものではありません。無理のない範囲でご利用ください。
        </footer>
      </main>

      {/* ===================================================================== */}
      {/* 3. 固定アクションバー                                                  */}
      {/* ===================================================================== */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 p-3 safe-bottom">
        <div className="max-w-xl mx-auto grid grid-cols-2 gap-3">
          {/* 不的中 (×) ボタン */}
          <button
            type="button"
            onClick={handleMiss}
            disabled={sequence.length === 0}
            className="h-14 rounded-2xl bg-slate-900 border border-slate-700 hover:bg-slate-800 active:scale-[0.98] text-rose-400 font-bold flex items-center justify-center gap-2 text-base shadow-lg shadow-black/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <XCircle className="w-5 h-5 text-rose-500" />
            <div className="text-left">
              <div className="leading-none text-sm text-slate-200">不的中 (×)</div>
              <div className="text-[10px] text-slate-400 font-normal font-num mt-0.5">
                右端に +{currentUnits}
              </div>
            </div>
          </button>

          {/* 的中 (○) ボタン */}
          <button
            type="button"
            onClick={openHitModal}
            disabled={sequence.length === 0}
            className="h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 active:scale-[0.98] text-slate-950 font-black flex items-center justify-center gap-2 text-base shadow-lg shadow-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <CheckCircle2 className="w-5 h-5 text-slate-950" />
            <div className="text-left">
              <div className="leading-none text-sm font-extrabold text-slate-950">的中！(○)</div>
              <div className="text-[10px] text-slate-900/80 font-bold font-num mt-0.5">
                払戻金入力へ
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 4. 的中配当入力ダイアログ                                             */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {isHitModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-slate-900 border border-slate-700/80 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                    🎯
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">的中・払い戻し金額の入力</h3>
                    <p className="text-[11px] text-slate-400">払い戻し金額から的中時オッズと消去数を自動判定</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsHitModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 払い戻し金額入力 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-slate-300">払い戻し金額 (円)</label>
                  <span className="text-[11px] font-num text-cyan-400 font-bold">
                    的中時オッズ: {hitPreview.recoveryRate.toFixed(2)} 倍
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    step="10"
                    value={hitRefundInput}
                    onChange={(e) => setHitRefundInput(e.target.value)}
                    placeholder="例: 1200"
                    className="w-full h-12 bg-slate-950 border border-slate-700 rounded-xl px-3 text-xl font-bold font-num text-white focus:outline-none focus:border-cyan-400"
                  />
                  <span className="absolute right-3 top-3 text-sm text-slate-500">円</span>
                </div>

                {/* リアルタイム換算・収支サマリー */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5 pt-0.5">
                  <span>
                    今回賭金: <strong className="text-slate-200 font-num">¥{actualTotal.toLocaleString()}</strong>
                  </span>
                  <span>
                    今回収支: <strong className={`font-num ${hitPreview.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {hitPreview.balance >= 0 ? '+' : ''}¥{hitPreview.balance.toLocaleString()}
                    </strong>
                  </span>
                </div>

                {/* クイック払戻金ボタン */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    { label: `2倍 (¥${(actualTotal * 2).toLocaleString()})`, val: actualTotal * 2 },
                    { label: `3倍 (¥${(actualTotal * 3).toLocaleString()})`, val: actualTotal * 3 },
                    { label: `4倍 (¥${(actualTotal * 4).toLocaleString()})`, val: actualTotal * 4 },
                    { label: `トントン (¥${actualTotal.toLocaleString()})`, val: actualTotal },
                    { label: '+¥500', add: 500 },
                    { label: '+¥1,000', add: 1000 },
                    { label: '+¥3,000', add: 3000 },
                    { label: '+¥10,000', add: 10000 },
                  ].map((btn, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if ('val' in btn) {
                          setHitRefundInput(String(btn.val));
                        } else if ('add' in btn) {
                          const current = parseInt(hitRefundInput, 10) || 0;
                          setHitRefundInput(String(Math.max(0, current + btn.add)));
                        }
                      }}
                      className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 border border-slate-700 font-medium transition-transform"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* リアルタイム試算プレビューカード */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-slate-400 tracking-wider flex items-center justify-between">
                    <span>消去ルール判定</span>
                    <span className="text-[10px] text-cyan-400 font-num">
                      払戻¥{hitPreview.refund.toLocaleString()} ÷ 賭金¥{actualTotal.toLocaleString()} ＝ {hitPreview.recoveryRate.toFixed(2)}倍
                    </span>
                  </div>
                  <div className="text-[11px] font-bold py-1.5 px-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                    {hitPreview.eraseCountPerSide >= 1 ? (
                      <span className="text-emerald-400 flex items-center gap-1.5 font-num flex-wrap">
                        <span className="text-xs">🎯 的中時オッズ {hitPreview.recoveryRate.toFixed(1)}倍 − 1 ＝</span>
                        <strong className="text-emerald-300 text-xs">左右から各{hitPreview.eraseCountPerSide}個ずつ消去</strong>
                        <span className="text-[10px] text-slate-400 font-normal">(計{hitPreview.totalErasedCount}個消去)</span>
                      </span>
                    ) : hitPreview.updateAction === 'right' ? (
                      <span className="text-amber-400 font-num text-xs">
                        ⚠️ 的中時オッズ 1倍台 (トントン〜微益) ➔ 右端のみ1個消去
                      </span>
                    ) : (
                      <span className="text-rose-400 font-num text-xs">
                        ❌ トリガミ (回収率1倍未満) ➔ 右端に指数(+{currentUnits})を追加
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-800">
                  <div>
                    <div className="text-[10px] text-slate-500">払戻金</div>
                    <div className="font-num font-bold text-emerald-400 text-sm mt-0.5">
                      ¥{hitPreview.refund.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">今回収支</div>
                    <div
                      className={`font-num font-bold text-sm mt-0.5 ${
                        hitPreview.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {hitPreview.balance >= 0 ? '+' : ''}¥{hitPreview.balance.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">的中時オッズ</div>
                    <div className="font-num font-bold text-cyan-300 text-sm mt-0.5">
                      {hitPreview.recoveryRate.toFixed(2)}倍
                    </div>
                  </div>
                </div>

                {/* 赤字打ち消し線プレビュー (画像表の表現) */}
                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>消去アニメーションプレビュー:</span>
                    <span className="text-[10px] text-slate-500 font-num">
                      消去: {hitPreview.totalErasedCount}個
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 px-2.5 py-2 rounded-lg font-num text-xs">
                    {sequence.map((num, idx) => {
                      let isErased = false;
                      if (hitPreview.eraseCountPerSide > 0) {
                        if (
                          idx < hitPreview.eraseCountPerSide ||
                          idx >= sequence.length - hitPreview.eraseCountPerSide
                        ) {
                          isErased = true;
                        }
                      } else if (hitPreview.updateAction === 'right') {
                        if (idx === sequence.length - 1) isErased = true;
                      }

                      return (
                        <span
                          key={idx}
                          className={`px-2 py-1 rounded ${
                            isErased
                              ? 'line-through text-rose-500 bg-rose-950/40 font-bold border border-rose-800/60'
                              : 'text-slate-200 bg-slate-800 border border-slate-700'
                          }`}
                        >
                          {num}
                        </span>
                      );
                    })}
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500 mx-1" />
                    <span className="text-emerald-400 font-bold">
                      {hitPreview.nextSequence.length === 0
                        ? 'クリア！(サイクル完了)'
                        : `[${hitPreview.nextSequence.join(', ')}]`}
                    </span>
                  </div>
                </div>

                {/* 次回賭け金 */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400">次回賭金:</span>
                  <span className="font-num font-bold text-cyan-400">
                    ¥{hitPreview.nextTotal.toLocaleString()} ({hitPreview.nextUnits}単位)
                  </span>
                </div>
              </div>

              {/* ボタン */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsHitModalOpen(false)}
                  className="h-11 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold text-xs"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={handleConfirmHit}
                  className="h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-sm shadow-md"
                >
                  確定する
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* 5. 画像「モンテカルロ法の解説表」モーダル                              */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {isExplanationTableOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl p-4 sm:p-5 flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                    📋
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">モンテカルロ法の解説表 (添付画像準拠)</h3>
                    <p className="text-[11px] text-slate-400">基準を100円にした場合の10レース推移</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExplanationTableOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 重要公式バナー */}
              <div className="my-3 p-3 bg-amber-950/40 border border-amber-600/50 rounded-xl text-xs text-amber-200">
                <p className="font-bold text-amber-300">
                  ★ 画像の重要消去ルール:
                </p>
                <p className="mt-0.5 font-num text-[11px]">
                  <strong>合成オッズ(この場合は3倍) − 1 ＝ 2個数式を消す</strong>
                  <br />
                  ・3倍的中: (3 − 1) = <strong>両端から2個ずつ（左2個＋右2個＝計4個）消去！</strong>
                  <br />
                  ・2倍的中: (2 − 1) = <strong>両端から1個ずつ（左1個＋右1個＝計2個）消去！</strong>
                </p>
              </div>

              {/* テーブル表示 */}
              <div className="flex-1 overflow-x-auto overflow-y-auto">
                <table className="w-full text-[11px] text-left border-collapse font-num">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <th className="py-2 px-1.5 text-center">レース</th>
                      <th className="py-2 px-1.5">数列</th>
                      <th className="py-2 px-1 text-center">指数</th>
                      <th className="py-2 px-1 text-center">的中</th>
                      <th className="py-2 px-1.5 text-center">合成オッズ</th>
                      <th className="py-2 px-2">終了後の数列</th>
                      <th className="py-2 px-1.5 text-right">賭金</th>
                      <th className="py-2 px-1.5 text-right">払い戻し</th>
                      <th className="py-2 px-2 text-right">収支</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {SAMPLE_EXPLANATION_TABLE.map((row) => (
                      <tr
                        key={row.race}
                        className={`hover:bg-slate-800/50 ${
                          row.hit === '○' ? 'bg-emerald-950/20' : ''
                        }`}
                      >
                        <td className="py-2 px-1.5 text-center font-bold text-slate-300">
                          {row.race}
                        </td>
                        <td className="py-2 px-1.5 text-slate-300">
                          {row.before.join('・')}
                        </td>
                        <td className="py-2 px-1 text-center font-bold text-cyan-400">
                          {row.index}
                        </td>
                        <td className="py-2 px-1 text-center">
                          {row.hit === '○' ? (
                            <span className="text-emerald-400 font-bold">○</span>
                          ) : (
                            <span className="text-rose-400 font-bold">×</span>
                          )}
                        </td>
                        <td className="py-2 px-1.5 text-center font-bold text-amber-300">
                          {row.odds}
                        </td>
                        <td className="py-2 px-2 font-mono">
                          {row.action === 'both_2' || row.action === 'both_1' ? (
                            <span className="text-rose-400 font-semibold">
                              {row.afterVisual}
                            </span>
                          ) : (
                            <span className="text-slate-300">{row.afterVisual}</span>
                          )}
                        </td>
                        <td className="py-2 px-1.5 text-right text-slate-300">
                          ¥{row.bet.toLocaleString()}
                        </td>
                        <td className="py-2 px-1.5 text-right text-emerald-400 font-semibold">
                          ¥{row.refund.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-bold ${
                            row.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {row.balance >= 0
                            ? `+¥${row.balance.toLocaleString()}`
                            : `(¥${Math.abs(row.balance).toLocaleString()})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsExplanationTableOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* 6. 履歴モーダル                                                       */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {isHistoryOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-slate-900 border border-slate-700 w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[88vh] flex flex-col"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-base font-bold text-white">実践レース履歴 ({history.length}件)</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    disabled={history.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1 shadow"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV出力</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsHistoryOpen(false)}
                    className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {history.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    まだ履歴がありません。「的中」または「不的中」を押すと自動記録されます。
                  </div>
                ) : (
                  history.map((record) => (
                    <div
                      key={record.id}
                      className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                              record.result === 'hit'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                            }`}
                          >
                            {record.result === 'hit' ? '的中(○)' : '不的中(×)'}
                          </span>
                          <span className="font-num font-bold text-slate-300">
                            Race #{record.raceNumber}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            (Cycle #{record.cycleNumber})
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500">{record.timestamp}</span>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-[11px] font-num pt-1">
                        <div>
                          <span className="text-slate-500 block text-[9px]">購入合計</span>
                          <span className="text-slate-300">¥{record.actualTotal.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px]">払戻金</span>
                          <span className="text-emerald-400">
                            {record.refund > 0 ? `¥${record.refund.toLocaleString()}` : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px]">損益</span>
                          <span
                            className={`font-bold ${
                              record.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {record.balance >= 0 ? '+' : ''}¥{record.balance.toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[9px]">合成オッズ</span>
                          <span className="text-cyan-300">
                            {record.recoveryRate > 0 ? `${record.recoveryRate.toFixed(2)}倍` : '-'}
                          </span>
                        </div>
                      </div>

                      {/* 数列変化 */}
                      <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-num text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <span>[{record.sequenceBefore.join(', ')}]</span>
                          <ArrowRight className="w-3 h-3 text-slate-600" />
                          <span className="text-white font-bold">
                            [{record.sequenceAfter.join(', ')}]
                          </span>
                        </div>
                        <span className="text-slate-500">
                          {record.updateAction === 'both_dynamic'
                            ? `左右から各${record.eraseCountPerSide}個消去 (オッズ${record.recoveryRate.toFixed(1)}倍)`
                            : record.updateAction === 'both_2'
                            ? '両端2個消去 (3倍公式)'
                            : record.updateAction === 'both_1'
                            ? '両端1個消去 (2倍公式)'
                            : record.updateAction === 'right'
                            ? '右端消去'
                            : record.updateAction === 'add'
                            ? '右端追加(トリガミ)'
                            : '右端追加(不的中)'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* 7. 設定モーダル                                                       */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-slate-900 border border-slate-700 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-base font-bold text-white">設定・ルール調整</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* 1. 初期数字列 */}
                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    初期数字列 (カンマ区切り)
                  </label>
                  <input
                    type="text"
                    value={settings.initialSequenceStr}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, initialSequenceStr: e.target.value }))
                    }
                    placeholder="1, 2, 3"
                    className="w-full h-10 bg-slate-950 border border-slate-700 rounded-xl px-3 font-num text-sm text-white focus:outline-none focus:border-cyan-400"
                  />
                  <div className="flex gap-1.5 mt-1.5">
                    {[
                      { label: '標準 (1,2,3)', val: '1, 2, 3' },
                      { label: '慎重 (1,1,1)', val: '1, 1, 1' },
                      { label: '短期 (1,2,3,4)', val: '1, 2, 3, 4' },
                    ].map((pre) => (
                      <button
                        key={pre.val}
                        type="button"
                        onClick={() =>
                          setSettings((prev) => ({ ...prev, initialSequenceStr: pre.val }))
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                      >
                        {pre.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. 基準額 (1単位の金額) */}
                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    基準額 (1単位の金額)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="100"
                      min="100"
                      value={settings.unitAmount}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          unitAmount: Math.max(100, parseInt(e.target.value, 10) || 100),
                        }))
                      }
                      className="w-full h-10 bg-slate-950 border border-slate-700 rounded-xl px-3 font-num text-sm text-white focus:outline-none focus:border-cyan-400"
                    />
                    <div className="flex gap-1 shrink-0">
                      {[100, 200, 500, 1000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setSettings((prev) => ({ ...prev, unitAmount: amt }))}
                          className={`px-2 py-1.5 rounded-lg text-xs font-bold ${
                            settings.unitAmount === amt
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          ¥{amt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 3. デフォルト賭ける点数 */}
                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    デフォルト賭ける点数 (1〜20点)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={settings.defaultPoints}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
                        setSettings((prev) => ({ ...prev, defaultPoints: val }));
                      }}
                      className="w-full h-10 bg-slate-950 border border-slate-700 rounded-xl px-3 font-num text-sm text-white focus:outline-none focus:border-cyan-400"
                    />
                    <div className="flex gap-1 shrink-0">
                      {[1, 2, 3, 4, 6].map((pt) => (
                        <button
                          key={pt}
                          type="button"
                          onClick={() => {
                            setSettings((prev) => ({ ...prev, defaultPoints: pt }));
                            setPoints(pt);
                          }}
                          className={`px-2 py-1.5 rounded-lg text-xs font-bold ${
                            settings.defaultPoints === pt
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {pt}点
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 4. 資金上限 */}
                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    資金上限警告ライン (円)
                  </label>
                  <input
                    type="number"
                    step="5000"
                    value={settings.bankrollLimit}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        bankrollLimit: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-full h-10 bg-slate-950 border border-slate-700 rounded-xl px-3 font-num text-sm text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {/* 5. 資金配分モード */}
                <div>
                  <label className="font-semibold text-slate-300 block mb-1">
                    資金配分モード (複数点購入時)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, allocationMode: 'exact' }))}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.allocationMode === 'exact'
                          ? 'bg-cyan-500/20 border-cyan-400 text-white ring-1 ring-cyan-400'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center gap-1">
                        <span>🎯 ぴったり配分</span>
                        {settings.allocationMode === 'exact' && <span className="text-[10px] text-cyan-400 font-normal">●</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        目標金額に一致（例: 400円/3点 ➔ 200+100+100=400円）
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, allocationMode: 'uniform' }))}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.allocationMode === 'uniform'
                          ? 'bg-cyan-500/20 border-cyan-400 text-white ring-1 ring-cyan-400'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center gap-1">
                        <span>⚖️ 均等切上</span>
                        {settings.allocationMode === 'uniform' && <span className="text-[10px] text-cyan-400 font-normal">●</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        全点数均等額（例: 400円/3点 ➔ 各200円=600円）
                      </div>
                    </button>
                  </div>
                </div>

                {/* 4. トグル設定 */}
                <div className="pt-2 border-t border-slate-800 space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-semibold text-slate-200 block">固定両端モード</span>
                      <span className="text-[10px] text-slate-500 block">
                        配当に関わらず、的中時は常に両端1個ずつを消去
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.fixedBothEndsMode}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, fixedBothEndsMode: e.target.checked }))
                      }
                      className="w-5 h-5 rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-semibold text-slate-200 block">サイクル完了時の自動再開</span>
                      <span className="text-[10px] text-slate-500 block">
                        数字列クリア時に初期数列で自動スタート
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoRestartOnComplete}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, autoRestartOnComplete: e.target.checked }))
                      }
                      className="w-5 h-5 rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                    />
                  </label>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full h-11 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm"
                >
                  保存して閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* 8. リセット確認モーダル                                               */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {isResetConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 max-w-sm w-full rounded-2xl shadow-2xl p-5 space-y-3.5"
            >
              <div className="flex items-center gap-2.5 text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-bold text-white">リセットの選択</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                現在のサイクルのみ初期数列に戻すか、全データ(累計収支・履歴含む)を完全初期化するか選択してください。
              </p>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleResetCurrentCycle}
                  className="w-full h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700"
                >
                  現在のサイクルのみリセット
                </button>
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md"
                >
                  全データを完全初期化 (累計・履歴含む)
                </button>
                <button
                  type="button"
                  onClick={() => setIsResetConfirmOpen(false)}
                  className="w-full h-9 rounded-xl text-slate-400 hover:text-white text-xs"
                >
                  キャンセル
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
