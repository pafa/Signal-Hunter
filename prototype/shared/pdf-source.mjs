export const PDF_SCOPE_SCHEMA='pdf-text-layer/1';
export const PDF_READER_VERSION='public-pdf-1';
export const MAX_PDF_BYTES=8_000_000;
export const MAX_PDF_PAGES=120;
export const MAX_PDF_TEXT=80000;
export const pdfPageMarker=n=>`[PDF page ${n}]`;
export const PDF_SCOPE_INSTRUCTIONS='extractionEvidence.schema=pdf-text-layer/1表示仅提取PDF文字层，页标记[PDF page N]由读取器添加，不是来源原文。页码、字符偏移与哈希仅用于定位，不能作为财务数值。页内文本按文件文字项顺序排列，不保证视觉阅读顺序、表格列对应、图形或脚注完整；不得从扁平文本猜测金额所属年份或单位。emptyPages为未提取到文字的页，不能认定为空白页；扫描图、图表、嵌入附件与签名未核验。creation/modification元数据不作为发布日期。需要版面或未读部分支持的判断保留unknown和missingEvidence，不能把文字层读取成功宣称为全文或财务核实。\n';
