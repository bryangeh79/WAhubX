// 2026-04-22 · 全球主流 telco 预置库 · 租户选 SIM 运营商用
// 覆盖 16 国 · SEA 全套 + 你指定的 US/UK/CN/IN/BD/AE
// 未预置国家 · 前端走 "自由填" 模式 (Tier 3)

export interface Telco {
  id: string;               // 内部 key · 唯一 (全库唯一, 非 per-country)
  name: string;             // 展示名 "Maxis"
  brand?: string;           // 子品牌 · 如 Hotlink (Maxis)
  color?: string;           // 槽位卡彩色小点
}

export interface PrefixHint {
  // 号码去掉国家代码后的前缀 (如马来西亚 +60 1**2** → prefix="12")
  // 命中则默认选中 defaultTelcoId
  prefix: string;
  defaultTelcoId: string;
}

export interface Country {
  code: string;             // ISO 3166-1 alpha-2
  callingCode: string;      // '60' · 不带 +
  flag: string;             // '🇲🇾'
  name: string;
  telcos: Telco[];
  prefixHints?: PrefixHint[];
}

// ────────────────────────────────────────────────────────────────
// 16 国 · 约 85 个 telco
// ────────────────────────────────────────────────────────────────
export const COUNTRY_REGISTRY: Country[] = [
  // ═══ 东南亚 ═══
  {
    code: 'MY',
    callingCode: '60',
    flag: '🇲🇾',
    name: 'Malaysia',
    telcos: [
      { id: 'maxis', name: 'Maxis', brand: 'Hotlink', color: '#00a551' },
      { id: 'celcom', name: 'CelcomDigi', brand: 'Celcom', color: '#004b87' },
      { id: 'digi', name: 'CelcomDigi', brand: 'Digi', color: '#ffcc00' },
      { id: 'umobile', name: 'U Mobile', color: '#ed174c' },
      { id: 'unifi', name: 'unifi Mobile', brand: 'TM', color: '#00c3a1' },
      { id: 'yes', name: 'YES 4G', color: '#a1cf45' },
      { id: 'redone', name: 'redONE', color: '#e60026' },
      { id: 'xox', name: 'XOX Mobile', color: '#ef7c00' },
    ],
    prefixHints: [
      // 历史号段 · 携号转网后不 100% 准 · 仅作默认推荐
      { prefix: '11', defaultTelcoId: 'maxis' },
      { prefix: '12', defaultTelcoId: 'maxis' },
      { prefix: '13', defaultTelcoId: 'celcom' },
      { prefix: '14', defaultTelcoId: 'digi' },
      { prefix: '15', defaultTelcoId: 'umobile' },
      { prefix: '16', defaultTelcoId: 'digi' },
      { prefix: '17', defaultTelcoId: 'umobile' },
      { prefix: '18', defaultTelcoId: 'umobile' },
      { prefix: '19', defaultTelcoId: 'celcom' },
    ],
  },
  {
    code: 'ID',
    callingCode: '62',
    flag: '🇮🇩',
    name: 'Indonesia',
    telcos: [
      { id: 'telkomsel', name: 'Telkomsel', color: '#e40000' },
      { id: 'indosat', name: 'Indosat (IM3)', color: '#ffcb05' },
      { id: 'xl', name: 'XL Axiata', color: '#00a0e3' },
      { id: 'smartfren', name: 'Smartfren', color: '#c40017' },
      { id: 'tri', name: 'Tri (3)', color: '#ff6900' },
      { id: 'byu', name: 'by.U', color: '#5bc0de' },
    ],
    prefixHints: [
      { prefix: '811', defaultTelcoId: 'telkomsel' },
      { prefix: '812', defaultTelcoId: 'telkomsel' },
      { prefix: '813', defaultTelcoId: 'telkomsel' },
      { prefix: '821', defaultTelcoId: 'telkomsel' },
      { prefix: '822', defaultTelcoId: 'telkomsel' },
      { prefix: '814', defaultTelcoId: 'indosat' },
      { prefix: '815', defaultTelcoId: 'indosat' },
      { prefix: '816', defaultTelcoId: 'indosat' },
      { prefix: '855', defaultTelcoId: 'indosat' },
      { prefix: '856', defaultTelcoId: 'indosat' },
      { prefix: '817', defaultTelcoId: 'xl' },
      { prefix: '818', defaultTelcoId: 'xl' },
      { prefix: '819', defaultTelcoId: 'xl' },
      { prefix: '877', defaultTelcoId: 'xl' },
      { prefix: '878', defaultTelcoId: 'xl' },
      { prefix: '881', defaultTelcoId: 'smartfren' },
      { prefix: '882', defaultTelcoId: 'smartfren' },
      { prefix: '895', defaultTelcoId: 'tri' },
      { prefix: '896', defaultTelcoId: 'tri' },
      { prefix: '897', defaultTelcoId: 'tri' },
      { prefix: '898', defaultTelcoId: 'tri' },
      { prefix: '899', defaultTelcoId: 'tri' },
    ],
  },
  {
    code: 'SG',
    callingCode: '65',
    flag: '🇸🇬',
    name: 'Singapore',
    telcos: [
      { id: 'singtel', name: 'Singtel', color: '#e60012' },
      { id: 'starhub', name: 'StarHub', color: '#00b04f' },
      { id: 'm1', name: 'M1', color: '#f7941d' },
      { id: 'circles', name: 'Circles.Life', color: '#ff5aa1' },
      { id: 'simba', name: 'Simba (TPG)', color: '#3f2a56' },
    ],
  },
  {
    code: 'TH',
    callingCode: '66',
    flag: '🇹🇭',
    name: 'Thailand',
    telcos: [
      { id: 'ais', name: 'AIS', color: '#00a651' },
      { id: 'truemoveh', name: 'TrueMove H', color: '#e30613' },
      { id: 'dtac', name: 'dtac', color: '#00a9e0' },
      { id: 'nt', name: 'NT Mobile', color: '#005baa' },
    ],
  },
  {
    code: 'VN',
    callingCode: '84',
    flag: '🇻🇳',
    name: 'Vietnam',
    telcos: [
      { id: 'viettel', name: 'Viettel', color: '#e30613' },
      { id: 'mobifone', name: 'MobiFone', color: '#e40000' },
      { id: 'vinaphone', name: 'Vinaphone', color: '#005baa' },
      { id: 'vietnamobile', name: 'Vietnamobile', color: '#ff6900' },
      { id: 'gmobile', name: 'Gmobile', color: '#7cb342' },
    ],
    prefixHints: [
      { prefix: '96', defaultTelcoId: 'viettel' },
      { prefix: '97', defaultTelcoId: 'viettel' },
      { prefix: '98', defaultTelcoId: 'viettel' },
      { prefix: '86', defaultTelcoId: 'viettel' },
      { prefix: '32', defaultTelcoId: 'viettel' },
      { prefix: '33', defaultTelcoId: 'viettel' },
      { prefix: '34', defaultTelcoId: 'viettel' },
      { prefix: '35', defaultTelcoId: 'viettel' },
      { prefix: '36', defaultTelcoId: 'viettel' },
      { prefix: '37', defaultTelcoId: 'viettel' },
      { prefix: '38', defaultTelcoId: 'viettel' },
      { prefix: '39', defaultTelcoId: 'viettel' },
      { prefix: '90', defaultTelcoId: 'mobifone' },
      { prefix: '93', defaultTelcoId: 'mobifone' },
      { prefix: '89', defaultTelcoId: 'mobifone' },
      { prefix: '70', defaultTelcoId: 'mobifone' },
      { prefix: '79', defaultTelcoId: 'mobifone' },
      { prefix: '77', defaultTelcoId: 'mobifone' },
      { prefix: '76', defaultTelcoId: 'mobifone' },
      { prefix: '78', defaultTelcoId: 'mobifone' },
      { prefix: '91', defaultTelcoId: 'vinaphone' },
      { prefix: '94', defaultTelcoId: 'vinaphone' },
      { prefix: '88', defaultTelcoId: 'vinaphone' },
      { prefix: '83', defaultTelcoId: 'vinaphone' },
      { prefix: '84', defaultTelcoId: 'vinaphone' },
      { prefix: '85', defaultTelcoId: 'vinaphone' },
      { prefix: '81', defaultTelcoId: 'vinaphone' },
      { prefix: '82', defaultTelcoId: 'vinaphone' },
      { prefix: '92', defaultTelcoId: 'vietnamobile' },
      { prefix: '56', defaultTelcoId: 'vietnamobile' },
      { prefix: '58', defaultTelcoId: 'vietnamobile' },
      { prefix: '99', defaultTelcoId: 'gmobile' },
      { prefix: '59', defaultTelcoId: 'gmobile' },
    ],
  },
  {
    code: 'PH',
    callingCode: '63',
    flag: '🇵🇭',
    name: 'Philippines',
    telcos: [
      { id: 'globe', name: 'Globe', color: '#005eb8' },
      { id: 'smart', name: 'Smart', color: '#00a651' },
      { id: 'dito', name: 'DITO', color: '#e30613' },
      { id: 'sun', name: 'Sun Cellular', color: '#f9a01b' },
      { id: 'tnt', name: 'TNT (Smart)', color: '#7cb342' },
      { id: 'tm', name: 'TM (Globe)', color: '#f9a01b' },
    ],
  },
  {
    code: 'KH',
    callingCode: '855',
    flag: '🇰🇭',
    name: 'Cambodia',
    telcos: [
      { id: 'cellcard', name: 'Cellcard', color: '#ffcb05' },
      { id: 'smart_axiata', name: 'Smart Axiata', color: '#e30613' },
      { id: 'metfone', name: 'Metfone', color: '#005baa' },
      { id: 'seatel', name: 'Seatel', color: '#ff6900' },
    ],
  },
  {
    code: 'MM',
    callingCode: '95',
    flag: '🇲🇲',
    name: 'Myanmar',
    telcos: [
      { id: 'mpt', name: 'MPT', color: '#00a0e3' },
      { id: 'ooredoo_mm', name: 'Ooredoo', color: '#e30613' },
      { id: 'atom', name: 'Atom (ex-Telenor)', color: '#00b04f' },
      { id: 'mytel', name: 'Mytel', color: '#ffcb05' },
    ],
  },
  {
    code: 'LA',
    callingCode: '856',
    flag: '🇱🇦',
    name: 'Laos',
    telcos: [
      { id: 'laotel', name: 'Lao Telecom', color: '#005baa' },
      { id: 'unitel', name: 'Unitel', color: '#e30613' },
      { id: 'etl', name: 'ETL', color: '#ffcb05' },
      { id: 'beeline_la', name: 'Beeline', color: '#ffd900' },
    ],
  },
  {
    code: 'BN',
    callingCode: '673',
    flag: '🇧🇳',
    name: 'Brunei',
    telcos: [
      { id: 'dst', name: 'DST', color: '#00b04f' },
      { id: 'progresif', name: 'Progresif', color: '#e30613' },
      { id: 'imagine_bn', name: 'imagine', color: '#00a0e3' },
    ],
  },
  // ═══ 你指定的其他国家 ═══
  {
    code: 'US',
    callingCode: '1',
    flag: '🇺🇸',
    name: 'United States',
    telcos: [
      { id: 'verizon', name: 'Verizon', color: '#cd040b' },
      { id: 'att', name: 'AT&T', color: '#00a8e0' },
      { id: 'tmobile', name: 'T-Mobile', color: '#e20074' },
      { id: 'uscellular', name: 'US Cellular', color: '#00649d' },
      { id: 'mint', name: 'Mint Mobile', color: '#76bc21' },
      { id: 'cricket', name: 'Cricket Wireless', color: '#00b140' },
      { id: 'metro', name: 'Metro by T-Mobile', color: '#e20074' },
      { id: 'visible', name: 'Visible (Verizon)', color: '#ffd400' },
      { id: 'boost', name: 'Boost Mobile', color: '#ff7e00' },
      { id: 'googlefi', name: 'Google Fi', color: '#4285f4' },
      { id: 'straight_talk', name: 'Straight Talk', color: '#e63946' },
      { id: 'xfinity_mobile', name: 'Xfinity Mobile', color: '#000000' },
    ],
  },
  {
    code: 'GB',
    callingCode: '44',
    flag: '🇬🇧',
    name: 'United Kingdom',
    telcos: [
      { id: 'ee', name: 'EE', color: '#00b5a4' },
      { id: 'o2', name: 'O2', color: '#0019a5' },
      { id: 'vodafone', name: 'Vodafone', color: '#e60000' },
      { id: 'three_uk', name: 'Three', color: '#ff0d70' },
      { id: 'giffgaff', name: 'giffgaff', color: '#000000' },
      { id: 'tesco_mobile', name: 'Tesco Mobile', color: '#e30613' },
      { id: 'sky_mobile', name: 'Sky Mobile', color: '#0072c9' },
      { id: 'voxi', name: 'VOXI (Vodafone)', color: '#ff7ebb' },
      { id: 'lebara', name: 'Lebara', color: '#ed1c24' },
      { id: 'id_mobile', name: 'iD Mobile', color: '#00b5a4' },
    ],
  },
  {
    code: 'CN',
    callingCode: '86',
    flag: '🇨🇳',
    name: 'China',
    telcos: [
      { id: 'chinamobile', name: '中国移动', color: '#005baa' },
      { id: 'chinaunicom', name: '中国联通', color: '#e60012' },
      { id: 'chinatelecom', name: '中国电信', color: '#005baa' },
      { id: 'chinabroadcast', name: '中国广电 (5G)', color: '#f9a01b' },
    ],
    prefixHints: [
      // 常见号段 (2024)
      { prefix: '134', defaultTelcoId: 'chinamobile' },
      { prefix: '135', defaultTelcoId: 'chinamobile' },
      { prefix: '136', defaultTelcoId: 'chinamobile' },
      { prefix: '137', defaultTelcoId: 'chinamobile' },
      { prefix: '138', defaultTelcoId: 'chinamobile' },
      { prefix: '139', defaultTelcoId: 'chinamobile' },
      { prefix: '147', defaultTelcoId: 'chinamobile' },
      { prefix: '150', defaultTelcoId: 'chinamobile' },
      { prefix: '151', defaultTelcoId: 'chinamobile' },
      { prefix: '152', defaultTelcoId: 'chinamobile' },
      { prefix: '157', defaultTelcoId: 'chinamobile' },
      { prefix: '158', defaultTelcoId: 'chinamobile' },
      { prefix: '159', defaultTelcoId: 'chinamobile' },
      { prefix: '178', defaultTelcoId: 'chinamobile' },
      { prefix: '182', defaultTelcoId: 'chinamobile' },
      { prefix: '183', defaultTelcoId: 'chinamobile' },
      { prefix: '184', defaultTelcoId: 'chinamobile' },
      { prefix: '187', defaultTelcoId: 'chinamobile' },
      { prefix: '188', defaultTelcoId: 'chinamobile' },
      { prefix: '130', defaultTelcoId: 'chinaunicom' },
      { prefix: '131', defaultTelcoId: 'chinaunicom' },
      { prefix: '132', defaultTelcoId: 'chinaunicom' },
      { prefix: '145', defaultTelcoId: 'chinaunicom' },
      { prefix: '155', defaultTelcoId: 'chinaunicom' },
      { prefix: '156', defaultTelcoId: 'chinaunicom' },
      { prefix: '166', defaultTelcoId: 'chinaunicom' },
      { prefix: '175', defaultTelcoId: 'chinaunicom' },
      { prefix: '176', defaultTelcoId: 'chinaunicom' },
      { prefix: '185', defaultTelcoId: 'chinaunicom' },
      { prefix: '186', defaultTelcoId: 'chinaunicom' },
      { prefix: '133', defaultTelcoId: 'chinatelecom' },
      { prefix: '149', defaultTelcoId: 'chinatelecom' },
      { prefix: '153', defaultTelcoId: 'chinatelecom' },
      { prefix: '173', defaultTelcoId: 'chinatelecom' },
      { prefix: '177', defaultTelcoId: 'chinatelecom' },
      { prefix: '180', defaultTelcoId: 'chinatelecom' },
      { prefix: '181', defaultTelcoId: 'chinatelecom' },
      { prefix: '189', defaultTelcoId: 'chinatelecom' },
      { prefix: '199', defaultTelcoId: 'chinatelecom' },
      { prefix: '192', defaultTelcoId: 'chinabroadcast' },
    ],
  },
  {
    code: 'IN',
    callingCode: '91',
    flag: '🇮🇳',
    name: 'India',
    telcos: [
      { id: 'jio', name: 'Jio', color: '#0044a4' },
      { id: 'airtel', name: 'Airtel', color: '#e4002b' },
      { id: 'vi_india', name: 'Vi (Vodafone Idea)', color: '#ed1c24' },
      { id: 'bsnl', name: 'BSNL', color: '#f9a01b' },
      { id: 'mtnl', name: 'MTNL', color: '#005baa' },
    ],
  },
  {
    code: 'BD',
    callingCode: '880',
    flag: '🇧🇩',
    name: 'Bangladesh',
    telcos: [
      { id: 'grameenphone', name: 'Grameenphone', color: '#00b5e2' },
      { id: 'robi', name: 'Robi', color: '#e30613' },
      { id: 'banglalink', name: 'Banglalink', color: '#ff6600' },
      { id: 'teletalk', name: 'Teletalk', color: '#00a651' },
      { id: 'airtel_bd', name: 'Airtel (BD)', color: '#e4002b' },
    ],
    prefixHints: [
      { prefix: '17', defaultTelcoId: 'grameenphone' },
      { prefix: '13', defaultTelcoId: 'grameenphone' },
      { prefix: '18', defaultTelcoId: 'robi' },
      { prefix: '16', defaultTelcoId: 'airtel_bd' },
      { prefix: '19', defaultTelcoId: 'banglalink' },
      { prefix: '14', defaultTelcoId: 'banglalink' },
      { prefix: '15', defaultTelcoId: 'teletalk' },
    ],
  },
  {
    code: 'AE',
    callingCode: '971',
    flag: '🇦🇪',
    name: 'UAE (Dubai)',
    telcos: [
      { id: 'etisalat', name: 'Etisalat', color: '#78be20' },
      { id: 'du', name: 'du', color: '#e4002b' },
      { id: 'virgin_ae', name: 'Virgin Mobile UAE', color: '#e4002b' },
    ],
  },
];

// ────────────────────────────────────────────────────────────────
// 根据国家代码查
// ────────────────────────────────────────────────────────────────
export function getCountry(code: string): Country | undefined {
  return COUNTRY_REGISTRY.find((c) => c.code === code.toUpperCase());
}

export function getTelcoById(telcoId: string): { telco: Telco; country: Country } | null {
  for (const c of COUNTRY_REGISTRY) {
    const t = c.telcos.find((x) => x.id === telcoId);
    if (t) return { telco: t, country: c };
  }
  return null;
}
