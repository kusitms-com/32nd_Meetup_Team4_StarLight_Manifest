import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';

const TEST_MODE = __ENV.TEST_MODE || 'smoke';
// AI(체크리스트 + 채점) 호출 포함 여부 (기본: false = 부하테스트용)
const ENABLE_AI = (__ENV.ENABLE_AI || 'false') === 'true';

// =============================
// 1. 커스텀 메트릭 정의
// =============================
const loginSuccessRate = new Rate('login_success_rate');
const listSuccessRate = new Rate('list_success_rate');
const createPlanSuccessRate = new Rate('create_plan_success_rate');
const tempSaveSuccessRate = new Rate('temp_save_success_rate'); // 👉 "제목+섹션 저장/조회" 성공률
const checklistSuccessRate = new Rate('checklist_success_rate'); // ← AI 켜져 있을 때만 사용
const scoringSuccessRate = new Rate('scoring_success_rate');
const expertConnectSuccessRate = new Rate('expert_connect_success_rate');
const totalFlowSuccessRate = new Rate('total_flow_success_rate');

const businessListLatency = new Trend('business_list_latency');
const errorCounter = new Counter('error_counter');

// =============================
// 2. 테스트 옵션
// =============================
function buildThresholds(base) {
    if (ENABLE_AI) {
        base['checklist_success_rate'] = ['rate>0.98'];
        base['scoring_success_rate'] = ['rate>0.95'];
    }
    return base;
}

const smokeOptions = {
    vus: 1,
    iterations: 1,
    maxDuration: '10m',
    thresholds: buildThresholds({
        'total_flow_success_rate': ['rate>0.95'],
        'login_success_rate': ['rate>0.99'],
        'list_success_rate': ['rate>0.98'],
        'create_plan_success_rate': ['rate>0.98'],
        'temp_save_success_rate': ['rate>0.98'],
        'expert_connect_success_rate': ['rate>0.95'],
        'http_req_duration': ['p(95)<2000'],
        'business_list_latency': ['p(95)<1500'],
        'http_req_failed': ['rate<0.01'],
    }),
    ext: {
        loadimpact: {
            projectID: 3512345,
            name: 'Starlight Business Plan Flow Test (smoke)',
        },
    },
};

const loadOptions = {
    stages: [
        { duration: '1m', target: 10 },  // Ramp-up
        { duration: '3m', target: 10 },  // Steady
        { duration: '1m', target: 30 },  // Spike
        { duration: '2m', target: 30 },  // Spike 유지
        { duration: '1m', target: 0 },   // Ramp-down
    ],

    thresholds: buildThresholds({
        'total_flow_success_rate': ['rate>0.95'],
        'login_success_rate': ['rate>0.99'],
        'list_success_rate': ['rate>0.98'],
        'create_plan_success_rate': ['rate>0.98'],
        'temp_save_success_rate': ['rate>0.98'],
        'expert_connect_success_rate': ['rate>0.95'],
        'http_req_duration': ['p(95)<2000'],
        'business_list_latency': ['p(95)<1500'],
        'http_req_failed': ['rate<0.01'],
    }),

    ext: {
        loadimpact: {
            projectID: 3512345,
            name: 'Starlight Business Plan Flow Test (load)',
        },
    },
};

export const options = TEST_MODE === 'smoke' ? smokeOptions : loadOptions;

// =============================
// 3. 환경 설정
// =============================
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const API_BASE_URL = `${BASE_URL}/v1`;

const TEST_USER = {
    email: '****',
    password: '****',
};

function authHeaders(token) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'k6-load-test',
    };
}

function generateBusinessPlanData() {
    return {
        title: `사업계획서_${Date.now()}_${__VU}_${__ITER}`,
        businessType: '기술 스타트업',
        description: '혁신적인 AI 기반 솔루션을 제공하는 사업',
        targetMarket: 'B2B SaaS',
        fundingAmount: Math.floor(Math.random() * 1000000) + 100000,
        businessPeriod: '3년',
        // 실제 API 스펙에 맞게 필드 추가/수정
    };
}

// =============================
// 3-1. Subsection 상수 & 실제 payload
// =============================

const SUBSECTION_TYPES = [
    'OVERVIEW_BASIC',
    'PROBLEM_BACKGROUND',
    'PROBLEM_PURPOSE',
    'PROBLEM_MARKET',
    'FEASIBILITY_STRATEGY',
    'FEASIBILITY_MARKET',
    'GROWTH_MODEL',
    'GROWTH_FUNDING',
    'GROWTH_ENTRY',
    'TEAM_FOUNDER',
    'TEAM_MEMBERS',
];

const SUBSECTION_PAYLOADS = {
    OVERVIEW_BASIC: {
        subSectionType: 'OVERVIEW_BASIC',
        checks: [false, false, false, false, false],
        meta: {
            author: 'string',
            createdAt: '1362-64-41',
        },
        blocks: [
            {
                meta: { title: '아이템명' },
                content: [
                    {
                        type: 'text',
                        value: 'AI카피로부터 버추얼 크리에이터의 목소리 자산을 지키는 음성 보호 서비스, 마이보이스',
                    },
                ],
            },
            {
                meta: { title: '아이템 한줄 소개' },
                content: [
                    {
                        type: 'text',
                        value: '국내 최초 "AI 목소리 도용방지"와 "목소리 수익화"를 제공하는 API기반 리얼타임 서비스',
                    },
                ],
            },
            {
                meta: { title: '아이템 / 아이디어 주요 기능' },
                content: [
                    {
                        type: 'text',
                        value:
                            '1. **AI목소리 도용방지:** AI 학습을 방해하여 허락없는 목소리 도용의 실시간 차단\n' +
                            '2. **목소리 수익화:** 크리에이터와 팬덤 요구에 맞춘 목소리 상품 제작',
                    },
                ],
            },
            {
                meta: { title: '관련 보유 기술' },
                content: [
                    {
                        type: 'text',
                        value:
                            '- 악성 바이러스처럼 AI 학습에만 영향을 미치는 비가청 노이즈 기술 적용 (적대적 공격 기술 활용)\n' +
                            '- 실시간 비가청 노이즈 통신 파이프라인 구현',
                    },
                ],
            },
            {
                meta: { title: '창업 목표' },
                content: [
                    {
                        type: 'text',
                        value:
                            '1. 목소리 보안 서비스로 도용 콘텐츠 방지 및 팬덤 보호\n' +
                            '2. 목소리 수익화 서비스로 콘텐츠의 정당한 가치를 일깨워 피해자 방지 실현',
                    },
                ],
            },
        ],
    },

    PROBLEM_BACKGROUND: {
        subSectionType: 'PROBLEM_BACKGROUND',
        checks: [false, false, false, false, false],
        meta: {
            author: 'string',
            createdAt: '1362-64-41',
        },
        blocks: [
            {
                meta: { title: '창업 배경 및 필요성' },
                content: [
                    {
                        type: 'text',
                        value:
                            '"AI의 발전으로 실제 같은 목소리 콘텐츠 생성, 그러나 대응책과 해결책은 부재"\n' +
                            '1. **목소리 크리에이터 산업의 성장, 그러나 무분별한 AI 음성 카피로 수익성 감소**\n' +
                            '  - 목소리 크리에이터 산업은 27년 753억달러를 예상(골드만삭스, 2022)하며 연 16%로 성장하는 급성장 산업임.\n' +
                            '  - AI 음성 카피는 무분별한 복제로 목소리 크리에이터에게 수익이 돌아가지 못하게 함.\n' +
                            '  - 그러나, 목소리 크리에이터들은 목소리 카피를 막을 수단이 없음.\n' +
                            '2. **AI 음성 카피로 인해 늘어나는 사칭 피해**\n' +
                            '  - 유명인의 목소리는 대중에 쉽게 공개돼 AI 음성 카피에 쉽게 소재로 활용됨.\n' +
                            '  - AI 음성 카피 범죄는 팬덤과 유명인에 영향을 끼치며 피해액은 23년 4분기에만 1,200억 수준임.\n' +
                            '  - 목소리 크리에이터 중 버튜버는 팬덤에 의존한 사업구조로 사칭 시 팬덤과 버튜버를 포함 큰 피해로 이어질 수 있음.\n' +
                            '마이보이스는 AI음성 카피로 인해 일어나는 목소리 크리에이터의 수익감소와 보이스 피싱 범죄 문제를 동시에 해결하고자 함.',
                    },
                ],
            },
        ],
    },

    PROBLEM_PURPOSE: {
        subSectionType: 'PROBLEM_PURPOSE',
        checks: [false, false, false, false, false],
        meta: {
            author: 'string',
            createdAt: '1362-64-41',
        },
        blocks: [
            {
                meta: { title: '창업 아이템의 목적 및 필요성' },
                content: [
                    {
                        type: 'text',
                        value:
                            '"AI 음성 카피로부터 안전한 버튜버의 수익 창출 환경 조성"\n' +
                            '버튜버는 실물이 아닌 가상 캐릭터와 목소리로 팬덤과 교류하는 보이스 크리에이터입니다. 목소리와 캐릭터의 1:1대응 관계, 라이브 스트리밍이라는 업종, 빠르게 성장하는 신규 산업이라는 특성상 AI보이스 도용에 취약하고 피해가 큰 시장입니다.\n' +
                            '1. **목소리와 캐릭터의 1:1 대응관계:** 목소리 도용 시 유사 콘텐츠의 구별법이 없으며 콘텐츠 수익 하락으로 직결됩니다.\n' +
                            '2. **라이브 스트리밍 업종 특성:** 다량의 음성을 장시간 사용하는 라이브 방송 상, 정보 보호가 어려우며, 다수의 팬덤을 대상으로 진행하는 업종상, AI 음성 사칭 시 대규모 피해를 야기합니다.\n' +
                            '3. **빠르게 성장하는 신 시장:** 버튜버 시장의 규모(21억달러, 2022) 대비 타 크리에이터 산업과 달리 규모 있는 에이전시가 부재합니다. 전 세계 버튜버 42,000여명 중 29.4%가 개인 버튜버로 체계적인 보안책이 부재합니다.\n' +
                            '해당 문제에 대한 시장 니즈와 규모가 크지만 해결책이 없던 버튜버 시장에, 마이보이스는\n' +
                            '1. 목소리 보안 서비스로 도용 콘텐츠 방지 및 팬덤 보호\n' +
                            '2. 목소리 수익화 서비스로 콘텐츠의 정당한 가치를 일깨워 피해자 방지를 실현하고자 합니다.',
                    },
                ],
            },
        ],
    },

    PROBLEM_MARKET: {
        subSectionType: 'PROBLEM_MARKET',
        checks: [false, false, false, false, false],
        meta: {
            author: 'string',
            createdAt: '1362-64-41',
        },
        blocks: [
            {
                meta: { title: '창업 아이템의 목표시장 분석' },
                content: [
                    {
                        type: 'text',
                        value:
                            '- **TAM : 글로벌 오디오 콘텐츠 시장**\n' +
                            '  - 글로벌 오디오 콘텐츠 시장규모는 2027년까지 753억달러(약 101조 7300억원)으로 성장 예상 (골드만삭스, 2019)\n' +
                            '  - 맞춤형 오디오 콘텐츠가 주목받고 있으며, 추후 오디오 콘텐츠 플랫폼 및 방송사와 연계하여 음성 수익창출 기반 확대 추진.\n' +
                            '- **SAM : 국내외 버튜버 시장**\n' +
                            '  - 2022년 일본 버튜버 시장규모 800억엔(약 7136억원), (YanoResearch, 2023)\n' +
                            '  - 일본 활성 버튜버 수 약 19,000명, 구독자 합계 2억 5800만명 (연평균성장률 19.2%)\n' +
                            '  - 기업 소속 버튜버 1명당 약 4900만원의 보이스팩 매출 발생.\n' +
                            '- **SOM : 국내 생방송 평균시청자 30명 이상의 버튜버**\n' +
                            '  - **고객 선정 이유:** 버튜버에게 목소리는 캐릭터의 큰 비중을 차지하며, 캐릭터성을 이용해 수익을 내므로 음성 보호 서비스 수요 및 보이스팩 판매를 통한 추가 수익 유인이 큼.\n' +
                            '  - **타겟 고객 분석:**\n' +
                            '    - 평균시청자 30~50명 버튜버의 월수입은 최저 92만원, 평균 258만원으로 자사의 저렴한 구독제(약 월 14,000원)와 추가수익창출 기회 제공을 고려하면 충분한 구매력을 갖췄다고 판단됨.\n' +
                            '    - 평균시청자 30명 이상의 버튜버는 464명, 평균팔로워는 4536명으로 210만명의 잠재 고객 존재.',
                    },
                ],
            },
        ],
    },

    FEASIBILITY_STRATEGY: {
        subSectionType: 'FEASIBILITY_STRATEGY',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '사업화 전략' },
                content: [
                    {
                        type: 'text',
                        value:
                            '**서비스 실행계획 (초기 시장 진출)**\n' +
                            '1. 팬덤 안전을 우려하는 평균 시청자 100명 미만의 버튜버 대상, 보안 기능이 탑재된 MVP 베타 테스트.\n' +
                            '2. 국내외 대형 버튜버(마왕, 향아치)와 협업으로 영상 콘텐츠 생산 및 구독자 맞춤 목소리 상품 출시.\n' +
                            '3. 가격 프로모션으로 고객층 확대 및 중소 버튜버들의 구독자 맞춤 목소리 상품 출시.\n' +
                            '4. 중소 에이전시들에게 기업형 서비스 제공 및 구독자 외 사용가능한 목소리 상품 출시.\n' +
                            '**서비스 확장계획**\n' +
                            '1. 모든 스트리머가 사용 가능하도록 국내 스트리밍 플랫폼에 서드파티로 제공.\n' +
                            '2. 해외 에이전시 대상 글로벌 서비스 제공 (니지산지, 홀로라이브).\n' +
                            '3. 해외 주요 스트리밍 플랫폼에 서드파티 참가.\n' +
                            '4. 버튜버 외 목소리 콘텐츠에 서비스 제공.\n' +
                            '**사업화 계획 및 실행방안 (로드맵)**\n' +
                            '1. **25년 2분기:** 목소리 보안 및 구독자 맞춤 상품의 고객 반응 확인 및 베타테스트 (평균 동시 시청자 30~100인 대상).\n' +
                            '2. **25년 4분기:** 가격 프로모션과 경험 사례 축적 (버튜버 100인 이상 확보), 대형 버튜버와 협업 콘텐츠 제작, 기업단위 기능 개발, 해외시장 진출 본격화(일본 중심).\n' +
                            '3. **26년 2분기:** 서비스 고객 및 목소리 수익화 사업 다변화 (애니메이션 이벤트 등), 국내외 플랫폼(아프리카tv, 치지직)에 서드파티 제공.',
                    },
                ],
            },
        ],
    },

    FEASIBILITY_MARKET: {
        subSectionType: 'FEASIBILITY_MARKET',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '시장분석 및 경쟁력 확보 방안' },
                content: [
                    {
                        type: 'text',
                        value:
                            '**[경쟁 및 대체제 분석]**\n' +
                            '- 국내외 사례 중 음성 딥페이크 \'방지\'를 상품화한 기업이나 서비스는 없음.\n' +
                            '- **대체제:** 오디오 워터마킹, 화자인식, 딥페이크 탐지 서비스.\n' +
                            '- **대체제 한계:**\n' +
                            '  1. 딥페이크 탐지는 복잡한 알고리즘으로 실시간 서비스에 한계가 있으며, 언어별 방대한 데이터가 필요해 서비스 확대가 어려움.\n' +
                            '  2. 딥페이크 탐지와 화자인식은 요구되는 최소 데이터량(최신 기술도 5~10분)을 채우지 못하면 신뢰도가 떨어짐.\n' +
                            '**경쟁력 확보 방안 (기술적 차별성)**\n' +
                            '1. **근본적인 방어:** 자사 원천기술은 인공지능 학습의 기본적인 매커니즘(적대적 공격 기술)을 공략하여 학습을 방해하므로, 발전된 딥페이크 기술에도 대응이 가능.\n' +
                            '2. **글로벌 확장성:** 적은 양의 언어데이터로도 수준 높은 모델 개발이 가능하여 글로벌 진출에 용이.\n' +
                            '3. **실시간 및 비용 효율:** 딥페이크 탐지 대비 가벼운 알고리즘으로 서버 비용 절감 및 실시간 서비스 가능.\n' +
                            '4. **고품질 및 편의성:** 최신 적대적 공격 기술로 잡음이 거의 들리지 않는 높은 퀄리티를 제공하며, 별도 설정 없이 스트리밍 환경에 자동 적용되어 간편한 사용자 경험을 제공.',
                    },
                ],
            },
        ],
    },

    GROWTH_MODEL: {
        subSectionType: 'GROWTH_MODEL',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '비즈니스 모델' },
                content: [
                    {
                        type: 'text',
                        value:
                            'API기반의 방송시간별 B2C 정기구독결제(보안 서비스), 목소리 상품 판매(수익화 서비스)\n' +
                            '**[보안 서비스 (B2C 구독)]** 구간별 요금제를 달리해 고객 맞춤 요금 제시.\n' +
                            '1. **스몰 단계 (소규모):** 고정 요금 월 5,453원\n' +
                            '2. **동네 스타 단계 (평균 동접 70명 이상):** 고정 요금 월 9,796원 (부가서비스: 모션 서비스 할인, 월 목소리 팩 등록 5개)\n' +
                            '3. **슈퍼스타 단계 (평균 동접 200명 이상):** 고정 요금 월 14,168원 (부가서비스: 월 목소리 팩 등록 20개)\n' +
                            '4. **기업요금제 (에이전시):** 분당 요금 및 단체요금 개별협의 (부가서비스: 목소리팩 등록 무제한)\n' +
                            '**[수익화 서비스 (B2C/B2B 판매)]**\n' +
                            '- **목소리팩:** 구독자 맞춤 프리미엄 콘텐츠(상황극, 오디오 드라마) 제작 및 유통 플랫폼 제공. (일반/이벤트/프리미엄으로 구분)\n' +
                            '**[확장 수익모델 (B2B)]**\n' +
                            '1. **플랫폼별 B2B 계약 공급:** 음성을 사용한 플랫폼에 서드파티로 보안 제공. 기본 서버 비용 수취(정액제).',
                    },
                ],
            },
        ],
    },

    GROWTH_FUNDING: {
        subSectionType: 'GROWTH_FUNDING',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '자금조달 계획' },
                content: [
                    {
                        type: 'text',
                        value:
                            '본 사업은 초기 기술 개발 및 시장 선점을 위한 자금 확보를 다음과 같이 계획합니다.\n' +
                            '- **초기 자본금 확보 방안 (Seed / Pre-A)**\n' +
                            '  - **1. 정부지원사업 활용:** 팀의 강력한 AI 기술 역량(KAIST, SNU 전공자 구성)을 바탕으로 \'팁스(TIPS)\' 프로그램에 지원하여 R&D 자금을 확보하는 것을 최우선 목표로 합니다. 또한, \'초기창업패키지\' 등 정부 지원사업을 통해 초기 사업화 자금을 확보합니다.\n' +
                            '  - **2. 엔젤 투자 유치:** AI 및 크리에이터 이코노미 분야에 전문성을 갖춘 엔젤 투자자 및 초기 VC를 대상으로 투자를 유치합니다. \'음성 AI 보안\'이라는 명확한 시장 니즈와 기술적 차별성을 강조하여 초기 자본을 확보합니다.\n' +
                            '  - **3. 자체 자금:** 창업 멤버들의 자체 자금을 투입하여 법인 설립 및 MVP 개발에 필요한 최소 비용을 충당합니다.\n' +
                            '- **운영 자금 확보 계획 (Bridge)**\n' +
                            '  - **1. 초기 매출을 통한 재투자:** \'25년 2분기 MVP 베타 테스트 이후 발생하는 \'보안 서비스(B2C 구독)\' 및 \'수익화 서비스(목소리팩 판매)\'의 초기 매출은 전액 R&D 고도화 및 마케팅(대형 버튜버 협업) 비용으로 재투자하여 운영 자금으로 활용합니다.\n' +
                            '  - **2. 린(Lean) 운영:** 사업 초기에는 핵심 R&D 인력과 기획/마케팅 인력 중심으로 팀을 운영하여 인건비 부담을 최소화하고, 클라우드 서버 비용 등 핵심 운영 비용에 자금을 집중합니다.\n' +
                            '  - **3. 정책 자금 활용:** 기술보증기금(KIBO)의 R&D 기술 보증 등을 활용하여 MVP 고도화 및 정식 서비스 런칭에 필요한 운영 자금을 확보합니다.\n' +
                            '- **향후 투자 유치 계획 (Series A ~)**\n' +
                            '  - **1. Seed 라운드 (25년 4분기 ~ 26년 1분기):**\n' +
                            '    - **목표:** MVP 성과(유료 버튜버 100인 이상 확보) 및 대형 버튜버 레퍼런스 확보 시점.\n' +
                            '    - **자금 사용처:** 핵심 기술 고도화, 일본 중심의 초기 해외시장 진출(마케팅 및 현지화), 핵심 인력(개발, 마케팅) 충원.\n' +
                            '    - **타겟:** AI 기술, 콘텐츠/미디어 분야 전문 초기 투자사(VC).\n' +
                            '  - **2. Series A 라운드 (26년 하반기 ~ 27년 상반기):**\n' +
                            '    - **목표:** 국내 주요 스트리밍 플랫폼 서드파티 제공(B2B) 계약 및 일본 시장 안착 확인 시점.\n' +
                            '    - **자금 사용처:** 글로벌 시장(북미, 유럽) 본격 확장, 서비스 다변화(버튜버 외 오디오 콘텐츠 시장 진출), B2B 세일즈 및 엔지니어링 팀 대규모 충원.',
                    },
                ],
            },
        ],
    },

    GROWTH_ENTRY: {
        subSectionType: 'GROWTH_ENTRY',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '시장진입 및 성과창출 전략' },
                content: [
                    {
                        type: 'text',
                        value:
                            '**시장진입 전략 (초기)**\n' +
                            '1. **MVP 테스트:** 평균 시청자 100명 미만의 소규모 버튜버 대상 베타 테스트를 통해 초기 고객 확보 및 피드백 수집.\n' +
                            '2. **메가 인플루언서 협업:** 국내외 대형 버튜버(예: 마왕, 향아치)와 협업하여 서비스 인지도 및 신뢰도 확보, 레퍼런스 구축.\n' +
                            '3. **프로모션:** 가격 프로모션을 통해 중소 버튜버 고객층 적극 확대.\n' +
                            '4. **B2B 공략:** 중소 에이전시를 대상으로 기업형 서비스 제공.\n' +
                            '**성과창출 전략 (수익 목표)**\n' +
                            '- **초기수익목표 (26년 3월 기준)** **→ 총 매출: 1억 1천 7백만원**\n' +
                            '  - 보안서비스 매출: 월 1360만원\n' +
                            '  - 수익화 서비스 매출: 월 8800만원',
                    },
                ],
            },
        ],
    },

    TEAM_FOUNDER: {
        subSectionType: 'TEAM_FOUNDER',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '창업자의 역량' },
                content: [
                    {
                        type: 'text',
                        value:
                            '**[대표] 김한준** "AI 개발 경험을 바탕으로 AI의 취약점을 공략하는 개발자 출신의 기획자"\n' +
                            '- **담당 업무:** 기획 및 개발\n' +
                            '- **보유 역량:**\n' +
                            '  1. 다양한 AI 프로젝트의 개발팀 프로젝트 리더 경험 보유\n' +
                            '  2. AI 서비스 개발 대회 수상 경력 보유\n' +
                            '  3. AI 서비스 스타트업 프론트엔드 개발자 경력 보유\n' +
                            '- **주요 이력 및 수상 실적:**\n' +
                            '  - 컴퓨터 비전을 통한 배리어프리 키오스크 제작 프로젝트\n' +
                            '  - 책의 분위기를 분석하여 시청각적인 몰입감을 주는 E북 서비스 프로젝트\n' +
                            '  - 2023 프로메테우스 AI 해커톤 우수 수상 | 킹슬리벤처스, AIFactory 후원\n' +
                            '  - 학생 창업유망팀 300 출신 우수팀 프론트엔드 개발자 출신\n' +
                            '  - 한국과학기술원(KAIST) 전산학부 전공',
                    },
                ],
            },
        ],
    },

    TEAM_MEMBERS: {
        subSectionType: 'TEAM_MEMBERS',
        checks: [false, false, false, false, false],
        meta: { author: 'string', createdAt: '1362-64-41' },
        blocks: [
            {
                meta: { title: '팀 구성원 소개 및 역량' },
                content: [
                    {
                        type: 'text',
                        value:
                            '"경영, 기획, 디자인, 개발, 열정, 경험을 두루 갖춘 육각형 팀 보유"\n' +
                            '- **신현섭**\n' +
                            '  - **담당 업무:** 경영 지원 / 데이터 분석\n' +
                            '  - **보유 역량:** 서울대학교 전기정보공학부 전공, 무인점포운영 해커톤 본선, 투자자산운용사/회계관리1급 자격 보유, 서울대학교 의료영상처리 대회 참여\n' +
                            '- **최성민**\n' +
                            '  - **담당 업무:** 디자인\n' +
                            '  - **보유 역량:** 한국과학기술원(KAIST) 산업디자인학과 전공, 현대자동차/GM모터스/한샘가구 디자인 참여, 공군 유튜브 영상 촬영병\n' +
                            '- **안재웅**\n' +
                            '  - **담당 업무:** 개발 (백엔드/ML 엔지니어)\n' +
                            '  - **보유 역량:** 한국과학기술원(KAIST) 전산학부 전공, AI 관련 창업 경험, 풀스택 개발 및 프로덕트 기획\n' +
                            '- **오호섭**\n' +
                            '  - **담당 업무:** 기획/마케팅\n' +
                            '  - **보유 역량:** 일본어, 영어 모국어 사용국가 장기간 체류 및 구사 강점, \'발효식품 엑스포\'등 다수 행사에 통역업무 참여, 공군검찰단 장병기자단 및 법률 활동',
                    },
                ],
            },
        ],
    },
};

// =============================
// 3-2. 로그 유틸
// =============================
const DEBUG = true;

function logStep(step, res, ok) {
    if (!DEBUG) return;
    const prefix = `[VU ${__VU}][ITER ${__ITER}][${step}]`;
    const dur = res.timings.duration;
    if (ok) {
        console.log(`${prefix} ✅ status=${res.status}, duration=${dur}ms`);
    } else {
        const bodySnippet = (res.body || '').substring(0, 300).replace(/\s+/g, ' ');
        console.error(`${prefix} ❌ status=${res.status}, duration=${dur}ms, body=${bodySnippet}`);
    }
}

// =============================
// 4. 메인 시나리오
// =============================
export default function () {
    let flowSuccess = true;
    let accessToken = null;
    let planId = null;

    // ---------------------------------
    // Step 1. 로그인
    // ---------------------------------
    group('01_Login', function () {
        const payload = JSON.stringify(TEST_USER);
        const res = http.post(
            `${API_BASE_URL}/auth/sign-in`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'k6-load-test',
                },
                tags: { name: 'Login' },
            }
        );

        const ok = check(res, {
            'login: status 200': (r) => r.status === 200,
            'login: contains tokens': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return (
                        body.result === 'SUCCESS' &&
                        body.data &&
                        body.data.accessToken &&
                        body.data.refreshToken
                    );
                } catch (e) {
                    return false;
                }
            },
            'login: < 800ms': (r) => r.timings.duration < 800,
        });

        logStep('01_Login', res, ok);

        if (ok) {
            const body = JSON.parse(res.body);
            accessToken = body.data.accessToken;
        } else {
            flowSuccess = false;
            errorCounter.add(1, { step: 'login' });
        }

        loginSuccessRate.add(ok);
    });

    if (!accessToken) {
        totalFlowSuccessRate.add(false);
        sleep(1);
        return;
    }

    sleep(1);

    const headers = authHeaders(accessToken);

    // ---------------------------------
    // Step 2. 내 사업계획서 목록 조회
    // ---------------------------------
    group('02_List_Business_Plans', function () {
        const res = http.get(
            `${API_BASE_URL}/business-plans`,
            {
                headers,
                tags: { name: 'ListPlans' },
            }
        );

        const ok = check(res, {
            'list: status 200': (r) => r.status === 200,
            'list: returns data': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.result === 'SUCCESS' && body.data !== undefined;
                } catch (e) {
                    return false;
                }
            },
            'list: < 1.5s': (r) => r.timings.duration < 1500,
        });

        businessListLatency.add(res.timings.duration);
        listSuccessRate.add(ok);
        logStep('02_List_Business_Plans', res, ok);

        if (!ok) {
            flowSuccess = false;
            errorCounter.add(1, { step: 'list' });
        }
    });

    sleep(2);

    // ---------------------------------
    // Step 3. 사업계획서 생성
    // ---------------------------------
    const businessPlanData = generateBusinessPlanData();

    group('03_Create_Business_Plan', function () {
        const res = http.post(
            `${API_BASE_URL}/business-plans`,
            JSON.stringify(businessPlanData),
            {
                headers,
                tags: { name: 'CreatePlan' },
            }
        );

        const ok = check(res, {
            'create: status 200/201': (r) => r.status === 200 || r.status === 201,
            'create: has id': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    const data = body.data || body;
                    planId = data.businessPlanId || data.id || data.planId;
                    return planId != null;
                } catch (e) {
                    return false;
                }
            },
            'create: < 1s': (r) => r.timings.duration < 1000,
        });

        createPlanSuccessRate.add(ok);
        logStep('03_Create_Business_Plan', res, ok);

        if (!ok) {
            flowSuccess = false;
            errorCounter.add(1, { step: 'create_plan' });
        }
    });

    if (!planId) {
        totalFlowSuccessRate.add(false);
        sleep(1);
        return;
    }

    sleep(2);

    // ---------------------------------
    // Step 4. 제목 + 모든 Subsection 저장 & 조회
    // ---------------------------------
    group('04_Title_And_Subsections', function () {
        let stepOk = true;

        // 4-1. 제목 조회
        const titleGetRes = http.get(
            `${API_BASE_URL}/business-plans/${planId}/titles`,
            {
                headers,
                tags: { name: 'GetTitle' },
            }
        );

        const titleGetOk = check(titleGetRes, {
            'title get: status 200': (r) => r.status === 200,
            'title get: success result': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.result === 'SUCCESS';
                } catch (e) {
                    return false;
                }
            },
        });

        logStep('04-1_Title_Get', titleGetRes, titleGetOk);
        if (!titleGetOk) {
            stepOk = false;
            flowSuccess = false;
            errorCounter.add(1, { step: 'title_get' });
        }

        // 4-2. 제목 저장
        const titleSavePayload = JSON.stringify({
            title: '성호의 사업계획서',
        });

        const titleSaveRes = http.patch(
            `${API_BASE_URL}/business-plans/${planId}`,
            titleSavePayload,
            {
                headers,
                tags: { name: 'SaveTitle' },
            }
        );

        const titleSaveOk = check(titleSaveRes, {
            'title save: status 200': (r) => r.status === 200,
            'title save: success result': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.result === 'SUCCESS';
                } catch (e) {
                    return false;
                }
            },
        });

        logStep('04-2_Title_Save', titleSaveRes, titleSaveOk);
        if (!titleSaveOk) {
            stepOk = false;
            flowSuccess = false;
            errorCounter.add(1, { step: 'title_save' });
        }

        // 4-3/4-4. 각 Subsection 저장 & 조회
        for (const type of SUBSECTION_TYPES) {
            const body = JSON.stringify(SUBSECTION_PAYLOADS[type]);

            // 저장 (POST; 서버가 PUT이면 http.put으로 변경)
            const subSaveRes = http.post(
                `${API_BASE_URL}/business-plans/${planId}/subsections`,
                body,
                {
                    headers,
                    tags: { name: `Subsection_Save_${type}` }
                }
            );

            const subSaveOk = check(subSaveRes, {
                [`${type} save: status 200/201`]: (r) => r.status === 200 || r.status === 201,
                [`${type} save: success`]: (r) => {
                    try {
                        const b = JSON.parse(r.body);
                        return (
                            b.result === 'SUCCESS' &&
                            b.data &&
                            b.data.subSectionType === type
                        );
                    } catch (e) {
                        return false;
                    }
                },
            });

            logStep(`04-3_Subsection_Save_${type}`, subSaveRes, subSaveOk);
            if (!subSaveOk) {
                stepOk = false;
                flowSuccess = false;
                errorCounter.add(1, { step: `subsection_save_${type}` });
            }

            // 조회
            const subGetRes = http.get(
                `${API_BASE_URL}/business-plans/${planId}/subsections/${type}`,
                {
                    headers,
                    tags: { name: `SubsectionGet_${type}` },
                }
            );

            const subGetOk = check(subGetRes, {
                [`${type} get: status 200`]: (r) => r.status === 200,
                [`${type} get: success`]: (r) => {
                    try {
                        const b = JSON.parse(r.body);
                        return (
                            b.result === 'SUCCESS' &&
                            b.data &&
                            b.data.content &&
                            b.data.content.subSectionType === type
                        );
                    } catch (e) {
                        return false;
                    }
                },
            });

            logStep(`04-4_Subsection_Get_${type}`, subGetRes, subGetOk);
            if (!subGetOk) {
                stepOk = false;
                flowSuccess = false;
                errorCounter.add(1, { step: `subsection_get_${type}` });
            }

            // 04-5 체크리스트 점검 & 업데이트 (check-and-update)
            // 👉 ENABLE_AI=true일 때만 호출 (OpenAI 부하 제외용)
            if (ENABLE_AI) {
                const checklistRes = http.post(
                    `${API_BASE_URL}/business-plans/${planId}/subsections/check-and-update`,
                    body,
                    {
                        headers,
                        tags: { name: `Subsection_CheckAndUpdate_${type}` },
                    }
                );

                const checklistOk = check(checklistRes, {
                    [`checklist: ${type}: status 200`]: (r) => r.status === 200,
                    [`checklist: ${type}: SUCCESS result`]: (r) => {
                        try {
                            const body = JSON.parse(r.body);
                            return body.result === 'SUCCESS';
                        } catch (e) {
                            return false;
                        }
                    },
                });

                checklistSuccessRate.add(checklistOk);

                if (!checklistOk) {
                    flowSuccess = false;
                    errorCounter.add(1, { step: 'checklist', subSectionType: type });
                    console.error(
                        `[VU ${__VU}][ITER ${__ITER}][04-5_Subsection_CheckAndUpdate_${type}] ❌ ` +
                        `status=${checklistRes.status}, duration=${checklistRes.timings.duration}ms, body=${checklistRes.body}`
                    );
                } else {
                    console.log(
                        `[VU ${__VU}][ITER ${__ITER}][04-5_Subsection_CheckAndUpdate_${type}] ✅ ` +
                        `status=${checklistRes.status}, duration=${checklistRes.timings.duration}ms`
                    );
                }
            }
        }

        tempSaveSuccessRate.add(stepOk);
    });

    sleep(2);

    // ---------------------------------
    // Step 5. AI 리포트 채점 (evaluation)
    // 👉 ENABLE_AI=true 일 때만 수행
    // ---------------------------------
    if (ENABLE_AI) {
        group('05_Scoring', function () {
            const res = http.post(
                `${API_BASE_URL}/ai-reports/evaluation/${planId}`,
                null,
                {
                    headers,
                    tags: { name: 'Scoring_AiReportEvaluation' },
                }
            );

            const ok = check(res, {
                'scoring: status 200': (r) => r.status === 200,
                'scoring: SUCCESS result': (r) => {
                    try {
                        const body = JSON.parse(r.body);
                        return body.result === 'SUCCESS';
                    } catch (e) {
                        return false;
                    }
                },
                'scoring: < 10000ms': (r) => r.timings.duration < 50000, // AI라 넉넉히 40초
            });

            scoringSuccessRate.add(ok);

            if (!ok) {
                flowSuccess = false;
                errorCounter.add(1, { step: 'scoring' });
                console.error(
                    `[VU ${__VU}][ITER ${__ITER}][05_Scoring] ❌ ` +
                    `status=${res.status}, duration=${res.timings.duration}ms, body=${res.body}`
                );
            } else {
                console.log(
                    `[VU ${__VU}][ITER ${__ITER}][05_Scoring] ✅ ` +
                    `status=${res.status}, duration=${res.timings.duration}ms`
                );
            }
        });
    }

    // ---------------------------------
    // Step 6. 전문가 연결
    // ---------------------------------
    group('06_Expert_Connect', function () {
        let stepOk = true;

        // 6-1 전체 전문가 목록 조회
        const expertsRes = http.get(
            `${API_BASE_URL}/experts`,
            {
                headers,
                tags: { name: 'Experts' },
            }
        );

        const expertsOk = check(expertsRes, {
            'experts: status 200': (r) => r.status === 200,
        });

        let allExperts = [];

        if (expertsOk) {
            try {
                const body = JSON.parse(expertsRes.body);
                // 페이징 구조일 수도 있으니 content 우선, 없으면 data 그대로 사용
                allExperts = body.data?.content || body.data || [];
                if (!Array.isArray(allExperts)) {
                    allExperts = [];
                }
                console.log(`[06-1] 전체 전문가 수: ${allExperts.length}`);
            } catch (e) {
                console.warn('[06-1] 전문가 목록 파싱 실패');
            }
        } else {
            stepOk = false;
            errorCounter.add(1, { step: 'experts' });
            console.error(
                `[VU ${__VU}][ITER ${__ITER}][06-1_Experts] ❌ status=${expertsRes.status}, body=${expertsRes.body}`
            );
        }

        // 전문가 목록이 없으면 더 진행 불가
        if (!expertsOk || allExperts.length === 0) {
            expertConnectSuccessRate.add(false);
            flowSuccess = false;
            return;
        }

        // 6-2 이미 신청한 전문가 ID 목록 조회
        const appliedRes = http.get(
            `${API_BASE_URL}/expert-applications?businessPlanId=${planId}`,
            {
                headers,
                tags: { name: 'Expert_Applications' },
            }
        );

        const appliedOk = check(appliedRes, {
            'applied experts: status 200 or 404': (r) => r.status === 200 || r.status === 404,
        });

        const alreadyRequested = new Set();

        if (appliedOk && appliedRes.status === 200) {
            try {
                const body = JSON.parse(appliedRes.body);
                const list = body.data || [];

                if (Array.isArray(list)) {
                    list.forEach((item) => {
                        if (typeof item === 'number') {
                            alreadyRequested.add(item);
                        } else if (item.expertId) {
                            alreadyRequested.add(item.expertId);
                        } else if (item.id) {
                            alreadyRequested.add(item.id);
                        }
                    });
                }
                console.log(
                    `[06-2] 이미 신청한 전문가 수: ${alreadyRequested.size}`
                );
            } catch (e) {
                console.warn('[06-2] 이미 신청 전문가 목록 파싱 실패');
            }
        } else if (!appliedOk && appliedRes.status !== 404) {
            stepOk = false;
            errorCounter.add(1, { step: 'expert_applications' });
            console.error(
                `[VU ${__VU}][ITER ${__ITER}][06-2_Expert_Applications] ❌ status=${appliedRes.status}, body=${appliedRes.body}`
            );
        }

        // 6-3 아직 신청 안 한 전문가 중 하나 선택
        let selectedExpertId = null;

        for (const e of allExperts) {
            const id = e.id || e.expertId;
            if (id != null && !alreadyRequested.has(id)) {
                selectedExpertId = id;
                break;
            }
        }

        if (!selectedExpertId) {
            console.warn(
                `[06-3] 신청 가능한(아직 요청 안 한) 전문가가 없습니다.`
            );
            expertConnectSuccessRate.add(false);
            flowSuccess = false;
            return;
        }

        console.log(`[06-3] 선택된 전문가 ID: ${selectedExpertId}`);

        // 6-3 전문가에게 신청 (multipart/form-data)
        const fd = new FormData();
        fd.append(
            'file',
            http.file('dummy pdf content', 'business-plan.pdf', 'application/pdf')
        );

        const multipartHeaders = {
            ...headers,
            'Content-Type': `multipart/form-data; boundary=${fd.boundary}`,
        };

        const requestRes = http.post(
            `${API_BASE_URL}/expert-applications/${selectedExpertId}/request?businessPlanId=${planId}`,
            fd.body(),
            {
                headers: multipartHeaders,
                tags: { name: 'Expert_Request' },
            }
        );

        const requestOk = check(requestRes, {
            'expert request: status 200': (r) => r.status === 200,
        });

        if (!requestOk) {
            stepOk = false;
            flowSuccess = false;
            errorCounter.add(1, { step: 'expert_request' });
            console.error(
                `[VU ${__VU}][ITER ${__ITER}][06-3_Expert_Request] ❌ status=${requestRes.status}, body=${requestRes.body}`
            );
        } else {
            console.log(
                `[VU ${__VU}][ITER ${__ITER}][06-3_Expert_Request] ✅ status=${requestRes.status}, duration=${requestRes.timings.duration}ms`
            );
        }

        expertConnectSuccessRate.add(stepOk);
    });


    // ---------------------------------
    // E2E 플로우 성공 여부 기록
    // ---------------------------------
    totalFlowSuccessRate.add(flowSuccess);

    if (DEBUG) {
        console.log(
            `[VU ${__VU}][ITER ${__ITER}] Flow ` +
            (flowSuccess ? '✅ SUCCESS' : '❌ FAILED') +
            `, planId=${planId}, ENABLE_AI=${ENABLE_AI}`
        );
    }

    sleep(1);
}

// =============================
// 5. Summary 리포트
// =============================
export function handleSummary(data) {
    return {
        stdout: textSummary(data),
        'summary.json': JSON.stringify(data, null, 2),
        'summary.html': htmlReport(data),
    };
}

function metricRate(data, name) {
    return ((data.metrics[name]?.values?.rate || 0) * 100).toFixed(2);
}

function p95(data, name) {
    return (data.metrics[name]?.values?.['p(95)'] || 0).toFixed(2);
}

function textSummary(data) {
    const aiLines = ENABLE_AI
        ? `
- 체크리스트 점검:     ${metricRate(data, 'checklist_success_rate')}%
- 채점하기:            ${metricRate(data, 'scoring_success_rate')}%`
        : '';

    return `
========================================
Starlight 사업계획서 플로우 부하테스트 결과
========================================

총 VUs (max): ${data.metrics.vus?.values?.max || 0}
총 요청 수: ${data.metrics.http_reqs?.values?.count || 0}
실패율: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%

[단계별 성공률]
- 로그인:              ${metricRate(data, 'login_success_rate')}%
- 목록 조회:           ${metricRate(data, 'list_success_rate')}%
- 계획서 생성:         ${metricRate(data, 'create_plan_success_rate')}%
- 제목/섹션 저장/조회: ${metricRate(data, 'temp_save_success_rate')}%${aiLines}
- 전문가 연결:         ${metricRate(data, 'expert_connect_success_rate')}%
- 전체 플로우:         ${metricRate(data, 'total_flow_success_rate')}%

[응답시간 P95]
- 전체 요청:           ${p95(data, 'http_req_duration')} ms
- 목록 조회:           ${p95(data, 'business_list_latency')} ms

에러 카운트: ${data.metrics.error_counter?.values?.count || 0} 건
(ENABLE_AI = ${ENABLE_AI})
========================================
`;
}

// 간단 HTML 리포트
function htmlReport(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Starlight Load Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    .metric { margin: 20px 0; padding: 15px; border-left: 4px solid #4CAF50; background: #f9f9f9; }
    .failed { border-left-color: #f44336; }
    h1 { color: #333; }
    .value { font-size: 24px; font-weight: bold; color: #4CAF50; }
  </style>
</head>
<body>
  <h1>Starlight 부하테스트 리포트</h1>

  <div class="metric">
    <h3>전체 플로우 성공률</h3>
    <div class="value">${metricRate(data, 'total_flow_success_rate')}%</div>
  </div>

  <div class="metric">
    <h3>총 요청 수</h3>
    <div class="value">${data.metrics.http_reqs?.values?.count || 0}</div>
  </div>

  <div class="metric ${data.metrics.http_req_failed?.values?.rate > 0.01 ? 'failed' : ''}">
    <h3>실패율</h3>
    <div class="value">${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%</div>
  </div>

  <div class="metric">
    <h3>응답시간 P95 (전체)</h3>
    <div class="value">${p95(data, 'http_req_duration')} ms</div>
  </div>

  <div class="metric">
    <h3>응답시간 P95 (목록 조회)</h3>
    <div class="value">${p95(data, 'business_list_latency')} ms</div>
  </div>

  <p>AI 단계 포함 여부: ${ENABLE_AI}</p>
  <p>생성 시간: ${new Date().toISOString()}</p>
</body>
</html>
`;
}
