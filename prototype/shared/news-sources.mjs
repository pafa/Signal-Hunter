export const NEWS_ADAPTER_VERSION='official-headlines-1';
export const OFFICIAL_NEWS_SOURCES=[
 {id:'fed',setting:'newsFedEnabled',label:'美联储新闻稿',publisher:'Federal Reserve Board',provider:'fed-rss',url:'https://www.federalreserve.gov/feeds/press_all.xml',documentation:'https://www.federalreserve.gov/feeds/feeds.htm',history:false,scope:'美联储新闻稿；RSS仅保留近期条目'},
 {id:'hkma',setting:'newsHkmaEnabled',label:'香港金管局新闻稿',publisher:'Hong Kong Monetary Authority',provider:'hkma-api',url:'https://api.hkma.gov.hk/public/press-releases',documentation:'https://apidocs.hkma.gov.hk/documentation/press-releases/',history:true,scope:'金管局新闻稿；日期查询，每次最多3页、300条'},
 {id:'csrc',setting:'newsCsrcEnabled',label:'中国证监会要闻',publisher:'中国证监会',provider:'csrc-public-list',url:'https://www.csrc.gov.cn/searchList/a1a078ee0bc54721ab6b148884c784a8',documentation:'https://www.csrc.gov.cn/csrc/c100028/common_xq_list.shtml',history:false,scope:'证监会要闻最新18条；不是上市公司公告全集'},
];
export const newsIntakeErrors=[
 '补采只支持金管局，日期不得晚于今天且一次最多31天','请先启用香港金管局来源','新闻采集正在进行，请完成后再补采','金管局最近已请求，请至少间隔一分钟后补采','本次补采未取得任务，请稍后重试',
 '来源重复返回同一页，已停止补采；此前页保留','分页没有新增条目，已停止；此前页保留','分页条目重叠，可能在收取期间变化；保留新增条目，完整性未证实','采集记录不存在',
 '官方RSS格式无效','官方来源未返回RSS','官方来源未返回JSON','金管局响应结构不匹配','证监会列表结构或栏目不匹配',
];
