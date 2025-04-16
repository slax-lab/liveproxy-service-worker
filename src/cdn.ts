const bypassRegexPatterns = [
  // === public cdn ===
  /jsdelivr\.net/,
  /cloudflare\.com/,
  /unpkg\.com/,
  /jquery\.com/,
  /googleapis\.com/,
  /bootcdn\.net/,
  /staticfile\.org/,
  /bootcss\.com/,
  /baomitu\.com/,
  /bootstrapcdn\.com/,
  /maxcdn\.bootstrapcdn\.com/,
  /cdn\.jsdelivr\.net/,
  /cdnjs\.cloudflare\.com/,
  /ajax\.googleapis\.com/,
  /adobedtm\.com/,
  /alicdn\.com/,
  /yimg\.com/,
  /360buyimg\.com/,
  /cloudflareinsights\.com/,
  /cdn\.office\.net/,
  /auth0\.com/,

  // === mirror ===
  /npmmirror\.com/,
  /npm\.taobao\.org/,
  /cnpmjs\.org/,
  /mirrors\.tencent\.com/,
  /repo\.huaweicloud\.com/,
  /registry\.npmjs\.org/,
  /registry\.yarnpkg\.com/,

  /maven\.aliyun\.com/,
  /repo1\.maven\.org/,
  /repo\.maven\.apache\.org/,
  /central\.maven\.org/,
  /uk\.maven\.org/,
  /maven\.apache\.org/,

  /pypi\.org/,
  /pythonhosted\.org/,
  /mirrors\.aliyun\.com/,
  /mirrors\.sustech\.edu\.cn/,
  /mirrors\.tuna\.tsinghua\.edu\.cn/,

  /mirrors\.ustc\.edu\.cn/,
  /mirrors\.yandex\.ru/,
  /mirrors\.aliyun\.com/,
  /mirrors\.tencent\.com/,
  /mirrors\.huaweicloud\.com/,
  /mirrors\.tuna\.tsinghua\.edu\.cn/,
  /mirrors\.arizona\.edu/,
  /mirror\.cse\.iitk\.ac\.in/,
  /mirror\.arizona\.edu/,
  /mirror\.yandex\.ru/,
  /mirror\.fsmg\.org\.nz/,
  /archive\.debian\.org/,
  /archive\.ubuntu\.org/,
  /download\.fedoraproject\.org/,
  /centos\.org/,
  /archlinux\.org/,

  // === font ===
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /use\.fontawesome\.com/,
  /at\.alicdn\.com/,
  /font\.static\.yximgs\.com/,

  // === analysis ===
  /google-analytics\.com/,
  /analytics\.google\.com/,
  /googletagmanager\.com/,
  /doubleclick\.net/,
  /googlesyndication\.com/,

  /hm\.baidu\.com/,
  /push\.zhanzhang\.baidu\.com/,
  /sp0\.baidu\.com/,
  /pos\.baidu\.com/,
  /cpro\.baidu\.com/,
  /zz\.bdstatic\.com/,

  /cnzz\.mmstat\.com/,
  /cnzz\.com/,

  /umeng\.com/,

  // === social ===
  /facebook\.net/,
  /twitter\.com/,
  /apis\.google\.com/,
  /linkedin\.com/,

  // === video ===
  /zencdn\.net/,
  /plyr\.io/,

  // === map ===
  /maps\.googleapis\.com/,
  /map\.baidu\.com/,
  /amap\.com/,

  // === other ===
  /polyfill\.io/,
  /recaptcha\.net/,
  /gstatic\.com/,
  /badjs\.weixinbridge\.com/,
  /res\.wx\.qq\.com/,
  /github\.githubassets\.com/,
  /\*.githubusercontent.com/,
  /cdn\.v2ex\.com/,
];

export function isCdnUrl(url: string) {
  if (!url) return false;

  return bypassRegexPatterns.some((pattern) => pattern.test(url));
}
