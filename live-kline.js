/**
 * live-kline.js — 浏览器端 K线增量更新 + 历史拉取模块
 * 从腾讯 API 拉取历史和增量 K 线，支持任意 A股/ETF 标的
 *
 * 数据源（均支持 CORS）：
 *   实时价：https://qt.gtimg.cn/q=<symbol>
 *   日K：    https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<symbol>,day,,,N,qfq
 *   分钟K：  https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=<symbol>,<m1|m5|m15|m30>,,N
 *
 * 使用：
 *   LiveKline.setSymbol('sh588710')           // 切换标的
 *   LiveKline.fetchAllHistory()               // 拉全部级别历史 → { daily, '30min', ... }
 *   LiveKline.updateLevel('1min', bars)       // 增量更新单级别
 *   LiveKline.updateAllLevels(DATA.levels)    // 增量更新所有级别
 */
(function (global) {
  'use strict';

  // 当前标的（带市场前缀 sh/sz），外部可改
  let SYMBOL = 'sh588710';

  // 级别 → 腾讯mkline 参数映射
  const TENCENT_MAP = {
    '1min':  'm1',
    '5min':  'm5',
    '15min': 'm15',
    '30min': 'm30',
  };
  // 每个级别增量请求的条数（足够覆盖一个完整交易日）
  const FETCH_COUNT = {
    '1min': 320, '5min': 100, '15min': 40, '30min': 20,
  };
  // 历史拉取的条数（初始化时）
  const HISTORY_COUNT = {
    'daily': 640, '30min': 800, '15min': 800, '5min': 800, '1min': 800,
  };

  function setSymbol(sym) { SYMBOL = sym; }
  function getSymbol() { return SYMBOL; }

  // 把腾讯时间戳 "202607090945" → 看板格式 "2026-07-09 09:45"
  function fmtTencentTime(raw) {
    if (!raw) return raw;
    raw = String(raw);
    if (raw.length === 8) return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8); // 日K
    if (raw.length >= 12) return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8) + ' ' + raw.slice(8, 10) + ':' + raw.slice(10, 12);
    return raw;
  }

  // 腾讯分钟K字段: [time, open, close, high, low, vol, {}, amount]
  function tencentMinuteToBar(row) {
    return {
      time: fmtTencentTime(row[0]),
      open: parseFloat(row[1]), close: parseFloat(row[2]),
      high: parseFloat(row[3]), low: parseFloat(row[4]),
      vol: parseFloat(row[5]) || 0,
      dif: 0, dea: 0, macd: 0,
    };
  }
  // 腾讯日K字段: [date, open, close, high, low, vol]
  function tencentDayToBar(row) {
    return {
      time: fmtTencentTime(row[0]),
      open: parseFloat(row[1]), close: parseFloat(row[2]),
      high: parseFloat(row[3]), low: parseFloat(row[4]),
      vol: parseFloat(row[5]) || 0,
      dif: 0, dea: 0, macd: 0,
    };
  }

  // 拉取日K历史（返回 bars 数组）
  // 注意：fqkline 接口对有分红的标的返回 qfqday 字段，无分红的返回 day 字段
  async function fetchDayHistory(count) {
    count = count || HISTORY_COUNT.daily;
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${SYMBOL},day,,,${count},qfq`;
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      const json = await resp.json();
      const symData = json && json.data && json.data[SYMBOL];
      if (!symData) return [];
      // 兼容 day（不复权）和 qfqday（前复权）两种字段
      const days = symData.qfqday || symData.day;
      if (!days) return [];
      return days.map(tencentDayToBar);
    } catch (e) { console.warn('[LiveKline] 日K fetch 失败', e.message); return []; }
  }

  // 拉取分钟K历史（返回 bars 数组）
  async function fetchMinuteHistory(levelKey, count) {
    const period = TENCENT_MAP[levelKey];
    if (!period) return [];
    count = count || HISTORY_COUNT[levelKey] || 800;
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${SYMBOL},${period},,${count}`;
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      const json = await resp.json();
      const rows = json && json.data && json.data[SYMBOL] && json.data[SYMBOL][period];
      if (!rows) return [];
      return rows.map(tencentMinuteToBar);
    } catch (e) { console.warn('[LiveKline] fetch 失败', levelKey, e.message); return []; }
  }

  // 拉取所有级别的历史 K 线，返回 { daily: [...], '30min': [...], ... }
  async function fetchAllHistory() {
    const [daily, m30, m15, m5, m1] = await Promise.all([
      fetchDayHistory(),
      fetchMinuteHistory('30min'),
      fetchMinuteHistory('15min'),
      fetchMinuteHistory('5min'),
      fetchMinuteHistory('1min'),
    ]);
    const result = {};
    if (daily.length) result.daily = daily;
    if (m30.length) result['30min'] = m30;
    if (m15.length) result['15min'] = m15;
    if (m5.length) result['5min'] = m5;
    if (m1.length) result['1min'] = m1;
    return result;
  }

  // 把历史 bars 包装成 DATA.levels[lv] 格式（chan 由外部引擎填充）
  function buildLevelData(bars) {
    return {
      bars,
      chan: {
        bis: [], segs: [], zss: [], bsps: [], fractals: [],
        bi_count: 0, seg_count: 0, zs_count: 0, bsp_count: 0,
        fx_count: 0, combined_kline_count: bars.length,
      },
    };
  }

  // 从腾讯 API 拉取最近的 N 条 K 线（增量更新用）
  async function fetchRecent(period, count) {
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${SYMBOL},${period},,${count}`;
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      const json = await resp.json();
      const data = json && json.data && json.data[SYMBOL];
      if (!data || !data[period]) return [];
      return data[period].map(tencentMinuteToBar);
    } catch (e) { console.warn('[LiveKline] fetch 失败', period, e.message); return []; }
  }

  // 增量合并：新拉的 bars 追加/替换到原数组尾部
  function mergeIncremental(origBars, newBars) {
    if (!newBars.length) return { added: 0, updated: 0 };
    if (!origBars.length) { origBars.push(...newBars); return { added: newBars.length, updated: 0 }; }
    const lastOrigTime = origBars[origBars.length - 1].time;
    let added = 0, updated = 0;
    for (const nb of newBars) {
      if (nb.time < lastOrigTime) continue;
      const existIdx = origBars.findIndex(b => b.time === nb.time);
      if (existIdx >= 0) { origBars[existIdx] = nb; updated++; }
      else if (nb.time > lastOrigTime) { origBars.push(nb); added++; }
    }
    return { added, updated };
  }

  async function updateLevel(levelKey, levelData) {
    const period = TENCENT_MAP[levelKey];
    if (!period || !levelData || !levelData.bars) return { added: 0, updated: 0 };
    const count = FETCH_COUNT[levelKey] || 100;
    const newBars = await fetchRecent(period, count);
    return mergeIncremental(levelData.bars, newBars);
  }

  async function updateAllLevels(levels) {
    const result = {};
    const tasks = [];
    for (const lv of ['30min', '15min', '5min', '1min']) {
      if (levels[lv]) tasks.push(updateLevel(lv, levels[lv]).then(r => { result[lv] = r; }));
    }
    await Promise.all(tasks);
    return result;
  }

  global.LiveKline = {
    setSymbol, getSymbol,
    fetchAllHistory, fetchDayHistory, fetchMinuteHistory, buildLevelData,
    updateLevel, updateAllLevels,
    fetchRecent, mergeIncremental, tencentMinuteToBar, fmtTencentTime,
    TENCENT_MAP, FETCH_COUNT, HISTORY_COUNT,
  };
})(typeof window !== 'undefined' ? window : this);
