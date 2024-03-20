import puppeteer, { Page, Browser } from 'puppeteer'
import treeKill from 'tree-kill';

import blockedHostsList from './blocked-hosts';

import { getDurationInDays, formatDate, getCleanText, getLocationFromText, statusLog, getHostname } from './utils'
import { SessionExpired } from './errors';

export interface Location {
  city: string | null;
  province: string | null;
  country: string | null
}


interface ScraperHistoryMemory {
  lastPostID: number;
  lastCommentID: number;
}

interface RawProfile {
  fullName: string | null;
  pronouns: string | null;
  title: string | null;
  location: string | null;
  about: string | null;
  photo: string | null;
  url: string;
}

export interface Profile {
  fullName: string | null;
  pronouns: string | null;
  title: string | null;
  location: Location | null;
  about: string | null;
  photo: string | null;
  url: string;
}

interface RawExperience {
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface Experience {
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

interface RawEducation {
  schoolName: string | null;
  degreeName: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface Education {
  schoolName: string | null;
  degreeName: string | null;
  startDate: string | null;
  endDate: string | null;
  durationInDays: number | null;
}

interface RawLicense {
  licenseName: string | null;
  licenseBody: string | null;
}

export interface License {
  licenseName: string | null;
  licenseBody: string | null;
}

interface RawLanguage {
  languageName: string | null;
  languageLevel: string | null;
}

export interface Language {
  languageName: string | null;
  languageLevel: string | null;
}

export interface Skill {
  skillName: string | null;
}

export interface Volunteering{
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface Honor {
  title: string | null;
  company: string | null;
  date: string | null;
  description: string | null;
}


interface ScraperUserDefinedOptions {
  /**
   * The LinkedIn `li_at` session cookie value. Get this value by logging in to LinkedIn with the account you want to use for scraping.
   * Open your browser's Dev Tools and find the cookie with the name `li_at`. Use that value here.
   * 
   * This script uses a known session cookie of a successful login into LinkedIn, instead of an e-mail and password to set you logged in. 
   * I did this because LinkedIn has security measures by blocking login requests from unknown locations or requiring you to fill in Captcha's upon login.
   * So, if you run this from a server and try to login with an e-mail address and password, your login could be blocked. 
   * By using a known session, we prevent this from happening and allows you to use this scraper on any server on any location.
   * 
   * You probably need to get a new session cookie value when the scraper logs show it's not logged in anymore.
   */
  sessionCookieValue: string;
  /**
   * Set to true if you want to keep the scraper session alive. This results in faster recurring scrapes.
   * But keeps your memory usage high.
   * 
   * Default: `false`
   */
  keepAlive?: boolean;
  /**
   * Set a custom user agent if you like.
   * 
   * Default: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36`
   */
  userAgent?: string;
  /**
   * Use a custom timeout to set the maximum time you want to wait for the scraper 
   * to do his job.
   * 
   * Default: `10000` (10 seconds)
   */
  timeout?: number;
  /**
   * Start the scraper in headless mode, or not.
   * 
   * Default: `true`
   */
  headless?: boolean;
}

interface ScraperOptions {
  sessionCookieValue: string;
  keepAlive: boolean;
  userAgent: string;
  timeout: number;
  headless: boolean;
}

async function autoScroll(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      var totalHeight = 0;
      var distance = 500;
      var timer = setInterval(() => {
        var scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

export class LinkedInProfileScraper {
  readonly options: ScraperOptions = {
    sessionCookieValue: '',
    keepAlive: false,
    timeout: 10000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
    headless: false
  }

  private browser: Browser | null = null;

  constructor(userDefinedOptions: ScraperUserDefinedOptions) {
    const logSection = 'constructing';
    const errorPrefix = 'Error during setup.';

    if (!userDefinedOptions.sessionCookieValue) {
      throw new Error(`${errorPrefix} Option "sessionCookieValue" is required.`);
    }
    
    if (userDefinedOptions.sessionCookieValue && typeof userDefinedOptions.sessionCookieValue !== 'string') {
      throw new Error(`${errorPrefix} Option "sessionCookieValue" needs to be a string.`);
    }
    
    if (userDefinedOptions.userAgent && typeof userDefinedOptions.userAgent !== 'string') {
      throw new Error(`${errorPrefix} Option "userAgent" needs to be a string.`);
    }

    if (userDefinedOptions.keepAlive !== undefined && typeof userDefinedOptions.keepAlive !== 'boolean') {
      throw new Error(`${errorPrefix} Option "keepAlive" needs to be a boolean.`);
    }
   
    if (userDefinedOptions.timeout !== undefined && typeof userDefinedOptions.timeout !== 'number') {
      throw new Error(`${errorPrefix} Option "timeout" needs to be a number.`);
    }
    
    if (userDefinedOptions.headless !== undefined && typeof userDefinedOptions.headless !== 'boolean') {
      throw new Error(`${errorPrefix} Option "headless" needs to be a boolean.`);
    }

    this.options = Object.assign(this.options, userDefinedOptions);

    statusLog(logSection, `Using options: ${JSON.stringify(this.options)}`);
  }

  /**
   * Method to load Puppeteer in memory so we can re-use the browser instance.
   */
  public setup = async () => {
    const logSection = 'setup'

    try {
      statusLog(logSection, `Launching puppeteer in the ${this.options.headless ? 'background' : 'foreground'}...`)

      this.browser = await puppeteer.launch({
        headless: false,
        executablePath: "/Applications/Chromium.app/Contents/MacOS/Chromium",
        // args: [
        //   ...(this.options.headless ? '---single-process' : '---start-maximized'),
        //   '--no-sandbox',
        //   '--disable-setuid-sandbox',
        //   "--proxy-server='direct://",
        //   '--proxy-bypass-list=*',
        //   '--disable-dev-shm-usage',
        //   '--disable-accelerated-2d-canvas',
        //   '--disable-gpu',
        //   '--disable-features=site-per-process',
        //   '--enable-features=NetworkService',
        //   '--allow-running-insecure-content',
        //   '--enable-automation',
        //   '--disable-background-timer-throttling',
        //   '--disable-backgrounding-occluded-windows',
        //   '--disable-renderer-backgrounding',
        //   '--disable-web-security',
        //   '--autoplay-policy=user-gesture-required',
        //   '--disable-background-networking',
        //   '--disable-breakpad',
        //   '--disable-client-side-phishing-detection',
        //   '--disable-component-update',
        //   '--disable-default-apps',
        //   '--disable-domain-reliability',
        //   '--disable-extensions',
        //   '--disable-features=AudioServiceOutOfProcess',
        //   '--disable-hang-monitor',
        //   '--disable-ipc-flooding-protection',
        //   '--disable-notifications',
        //   '--disable-offer-store-unmasked-wallet-cards',
        //   '--disable-popup-blocking',
        //   '--disable-print-preview',
        //   '--disable-prompt-on-repost',
        //   '--disable-speech-api',
        //   '--disable-sync',
        //   '--disk-cache-size=33554432',
        //   '--hide-scrollbars',
        //   '--ignore-gpu-blacklist',
        //   '--metrics-recording-only',
        //   '--mute-audio',
        //   '--no-default-browser-check',
        //   '--no-first-run',
        //   '--no-pings',
        //   '--no-zygote',
        //   '--password-store=basic',
        //   '--use-gl=swiftshader',
        //   '--use-mock-keychain'
        // ],
      })

      statusLog(logSection, 'Puppeteer launched!')

      // await this.checkIfLoggedIn();

      statusLog(logSection, 'Done!')
    } catch (err) {
      // Kill Puppeteer
      await this.close();

      statusLog(logSection, 'An error occurred during setup.')

      throw err
    }
  };

  /**
   * Create a Puppeteer page with some extra settings to speed up the crawling process.
   */
  private createPage = async (): Promise<Page> => {
    const logSection = 'setup page'

    if (!this.browser) {
      throw new Error('Browser not set.');
    }

    // Important: Do not block "stylesheet", makes the crawler not work for LinkedIn
    const blockedResources = ['media', 'font', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'];

    try {
      const page = await this.browser.newPage()
      // await page.setDefaultNavigationTimeout(0);

      // Use already open page
      // This makes sure we don't have an extra open tab consuming memory
      const firstPage = (await this.browser.pages())[0];
      await firstPage.close();

      // Method to create a faster Page
      // From: https://github.com/shirshak55/scrapper-tools/blob/master/src/fastPage/index.ts#L113
      const session = await page.target().createCDPSession()
      await page.setBypassCSP(true)
      await session.send('Page.enable');
      await session.send('Page.setWebLifecycleState', {
        state: 'active',
      });

      statusLog(logSection, `Blocking the following resources: ${blockedResources.join(', ')}`)

      // A list of hostnames that are trackers
      // By blocking those requests we can speed up the crawling
      // This is kinda what a normal adblocker does, but really simple
      const blockedHosts = this.getBlockedHosts();
      const blockedResourcesByHost = ['script', 'xhr', 'fetch', 'document']

      statusLog(logSection, `Should block scripts from ${Object.keys(blockedHosts).length} unwanted hosts to speed up the crawling.`);

      // Block loading of resources, like images and css, we dont need that
      await page.setRequestInterception(true);

      page.on('request', (req) => {
        if (blockedResources.includes(req.resourceType())) {
          return req.abort()
        }

        const hostname = getHostname(req.url());

        // Block all script requests from certain host names
        if (blockedResourcesByHost.includes(req.resourceType()) && hostname && blockedHosts[hostname] === true) {
          statusLog('blocked script', `${req.resourceType()}: ${hostname}: ${req.url()}`);
          return req.abort();
        }

        return req.continue()
      })

      await page.setUserAgent(this.options.userAgent)

      await page.setViewport({
        width: 1200,
        height: 720
      })

      statusLog(logSection, `Setting session cookie using cookie: ${process.env.LINKEDIN_SESSION_COOKIE_VALUE}`)

      await page.setCookie({
        'name': 'li_at',
        'value': this.options.sessionCookieValue,
        'domain': '.www.linkedin.com'
      })

      statusLog(logSection, 'Session cookie set!')

      statusLog(logSection, 'Done!')

      return page;
    } catch (err) {
      // Kill Puppeteer
      await this.close();

      statusLog(logSection, 'An error occurred during page setup.')
      statusLog(logSection, err.message)

      throw err
    }
  };

  /**
   * Method to block know hosts that have some kind of tracking.
   * By blocking those hosts we speed up the crawling.
   * 
   * More info: http://winhelp2002.mvps.org/hosts.htm
   */
  private getBlockedHosts = (): object => {
    const blockedHostsArray = blockedHostsList.split('\n');

    let blockedHostsObject = blockedHostsArray.reduce((prev, curr) => {
      const frags = curr.split(' ');

      if (frags.length > 1 && frags[0] === '0.0.0.0') {
        prev[frags[1].trim()] = true;
      }

      return prev;
    }, {});

    blockedHostsObject = {
      ...blockedHostsObject,
      'static.chartbeat.com': true,
      'scdn.cxense.com': true,
      'api.cxense.com': true,
      'www.googletagmanager.com': true,
      'connect.facebook.net': true,
      'platform.twitter.com': true,
      'tags.tiqcdn.com': true,
      'dev.visualwebsiteoptimizer.com': true,
      'smartlock.google.com': true,
      'cdn.embedly.com': true
    }

    return blockedHostsObject;
  }

  /**
   * Method to complete kill any Puppeteer process still active.
   * Freeing up memory.
   */
  public close = (page?: Page): Promise<void> => {

    return new Promise (async (resolve, reject) => {

      resolve()
    })

    return new Promise(async (resolve, reject) => {
      const loggerPrefix = 'close';

      if (page) {
        try {
          statusLog(loggerPrefix, 'Closing page...');
          await page.close();
          statusLog(loggerPrefix, 'Closed page!');
        } catch (err) {
          reject(err)
        }
      }

      if (this.browser) {
        try {
          statusLog(loggerPrefix, 'Closing browser...');
          await this.browser.close();
          statusLog(loggerPrefix, 'Closed browser!');

          const browserProcessPid = this.browser?.process()?.pid;

          // Completely kill the browser process to prevent zombie processes
          // https://docs.browserless.io/blog/2019/03/13/more-observations.html#tip-2-when-you-re-done-kill-it-with-fire
          if (browserProcessPid) {
            statusLog(loggerPrefix, `Killing browser process pid: ${browserProcessPid}...`);

            treeKill(browserProcessPid, 'SIGKILL', (err) => {
              if (err) {
                return reject(`Failed to kill browser process pid: ${browserProcessPid}`);
              }

              statusLog(loggerPrefix, `Killed browser pid: ${browserProcessPid} Closed browser.`);
              resolve()
            });
          }
        } catch (err) {
          reject(err);
        }
      }

      return resolve()
    })

  }

  /**
   * Simple method to check if the session is still active.
   */
  public checkIfLoggedIn = async () => {
    const logSection = 'checkIfLoggedIn';

    const page = await this.createPage();

    statusLog(logSection, 'Checking if we are still logged in...')

    // Go to the login page of LinkedIn
    // If we do not get redirected and stay on /login, we are logged out
    // If we get redirect to /feed, we are logged in
    await page.goto('https://www.linkedin.com/login', {
    })

    const url = page.url()

    const isLoggedIn = !url.endsWith('/login')

    await page.close();

    if (isLoggedIn) {
      statusLog(logSection, 'All good. We are still logged in.')
    } else {
      const errorMessage = 'Bad news, we are not logged in! Your session seems to be expired. Use your browser to login again with your LinkedIn credentials and extract the "li_at" cookie value for the "sessionCookieValue" option.';
      statusLog(logSection, errorMessage)
      throw new SessionExpired(errorMessage)
    }
  };

  public extractUnixTimestamp(postId) {
    // BigInt needed as we need to treat postId as 64 bit decimal. This reduces browser support.
    // @ts-ignore
    const asBinary = BigInt(postId).toString(2);
    const first41Chars = asBinary.slice(0, 41);
    const timestamp = parseInt(first41Chars, 2);
    return timestamp;
  }
  
  public unixTimestampToHumanDate(timestamp) {
    const dateObject = new Date(timestamp);
    const humanDateFormat = dateObject.toUTCString()+" (UTC)";
    return humanDateFormat;
  }
  
  public getDate(postId) {
    const unixTimestamp = this.extractUnixTimestamp(postId);
    const humanDateFormat = this.unixTimestampToHumanDate(unixTimestamp);
    return {
      unixTimestamp,
      humanDateFormat
    }
  }

  public getPosts = async (scraperSessionId: number, profileUrl: string, lastPostID:number) => {
    const logSection = 'getPosts'
    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn posts: ${profileUrl}recent-activity/all/`, scraperSessionId)

      await page.goto(`${profileUrl}recent-activity/all/`, {
      });

      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn posts page loaded!', scraperSessionId)

      statusLog(logSection, 'Getting all the LinkedIn post data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);

      // statusLog(logSection, 'Parsing data...', scraperSessionId)

      // const seeMoreButtonsSelectors = ['.feed-shared-inline-show-more-text__see-more-text']

      // statusLog(logSection, 'Expanding all posts by clicking their "See more" buttons', scraperSessionId)

      // // To give a little room to let data appear. Setting this to 0 might result in "Node is detached from document" errors
      // await page.waitForTimeout(5000);

      // statusLog(logSection, 'Expanding all descriptions by clicking their "See more" buttons', scraperSessionId)

      // for (const seeMoreButtonSelector of seeMoreButtonsSelectors) {
      //   const buttons = await page.$$(seeMoreButtonSelector)

      //   for (const button of buttons) {
      //     if (button) {
      //       try {
      //         statusLog(logSection, `Clicking button ${seeMoreButtonSelector}`, scraperSessionId)
      //         await button.click()
      //       } catch (err) {
      //         statusLog(logSection, `Could not find or click see more button selector "${button}". So we skip that one.`, scraperSessionId)
      //       }
      //     }
      //   }
      // }

      statusLog(logSection, 'Parsing Post data...', scraperSessionId)

      const rawUserPostData: any = await page.evaluate(() => {

        const posts = document.querySelectorAll(".profile-creator-shared-feed-update__container")

        const postDataArray:any = []

        //@ts-ignore
        for (const post of posts) {
          // log number of posts 

          // page.waitForSelector('.profile-creator-shared-feed-update__container')
          const postIdDict = post.querySelector('[data-urn]')?.dataset?.urn || null
          let postId
          let postDateDetails
          if(postIdDict){
            postId = postIdDict.split(':')[3]
            const asBinary = BigInt(postId).toString(2);
            const first41Chars = asBinary.slice(0, 41);
            const timestamp = parseInt(first41Chars, 2);
            const dateObject = new Date(timestamp);
            const humanDateFormat = dateObject.toUTCString()+" (UTC)";
            postDateDetails = humanDateFormat
          } else {
            postId = null
            postDateDetails = null
          }

          const postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${postId}`

          const postTextElement = post.querySelector('.break-words')
          const postText = postTextElement?.textContent || null

          const postReactions = post.querySelector('.social-details-social-counts__reactions-count')
          const postLikes = parseInt(postReactions?.textContent) || 0

          const postCommentsElement = post.querySelector('.social-details-social-counts__comments')
          const postComments = parseInt(postCommentsElement?.textContent.replace(" comments", "")) || null

          const postSharesElement = post.querySelector('.social-details-social-counts__item--right-aligned:not(.social-details-social-counts__comments)')
          const postShares = parseInt(postSharesElement?.textContent.replace(" reposts", "")) || null

          const postData = {
            postId,
            postText,
            postDateDetails,
            postLikes,
            postComments,
            postShares,
            postUrl
          }

          postDataArray.push(postData)
        }

        return postDataArray
      })

      const filteredUserPostData = rawUserPostData.filter((post) => {
        return post.postId > lastPostID
      })

      const userPostData: any = {
        ...filteredUserPostData,
      }

      statusLog(logSection, `Got user post data: ${JSON.stringify(userPostData)}`, scraperSessionId)

      return userPostData
    } catch (err) {
      // Kill Puppeteer
      // await this.close()

      statusLog(logSection, 'An error occurred during a run.')

      // Throw the error up, allowing the user to handle this error himself.
      throw err;
    }
  }

  public getComments = async (scraperSessionId: number, profileUrl: string, lastCommentID: number) => {
    const logSection = 'getComments'
    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn comments: ${profileUrl}/recent-activity/comments/`, scraperSessionId)

      await page.goto(`${profileUrl}/recent-activity/comments/`, {
      });
      
      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn comments page loaded!', scraperSessionId)

      statusLog(logSection, 'Getting all the LinkedIn comments data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);

      statusLog(logSection, 'Parsing comment data...', scraperSessionId)

      await page.waitForTimeout(5000);
      
      const rawComment: any = await page.evaluate(() => {
        var comments = document.getElementsByClassName("comments-comment-item")

        let profile_owner_comments : { commentId: string | number; commentText: string; commentDateDetails: string; }[] = []

        var profile_owner = document.title.split(" | ")[1]
        for (let i = 0; i < comments.length; i++) {
            var author_span = comments[i].querySelector<HTMLElement>('.comments-post-meta__name-text')!
            if (author_span.querySelector<HTMLElement>('span[aria-hidden="true"]')) {
                var author = author_span.querySelector<HTMLElement>('span[aria-hidden="true"]')!.innerText
            } else {
                var author = author_span.innerText
            }
            var commentText = comments[i].querySelector<HTMLElement>('.comments-comment-item__main-content')!.innerText
            if (author == profile_owner) {
                if (!profile_owner_comments.map(x=>x.commentText).includes(commentText)) {
                    let commentId = comments[i].getAttribute('data-id')?.split(":")[4].split(",")[1].split(')')[0] || 0;
                    let commentPostId = comments[i].getAttribute('data-id')?.split(":")[4].split(",")[0] || 0;
                    const asBinary = BigInt(commentId).toString(2);
                    const first41Chars = asBinary.slice(0, 41);
                    const timestamp = parseInt(first41Chars, 2);
                    const dateObject = new Date(timestamp);
                    const humanDateFormat = dateObject.toUTCString()+" (UTC)";

                    const commentData = {
                      commentId: commentId,
                      commentPostId: commentPostId,
                      commentText: commentText,
                      commentDateDetails: humanDateFormat,
                      commentUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${commentPostId}/?commentUrn=urn:li:comment:(activity:${commentPostId},${commentId})&dashCommentUrn=urn:li:fsd_comment:(${commentId},urn:li:activity:${commentPostId})`
                    }
                    profile_owner_comments.push(commentData)
                }
            }
        }
        return profile_owner_comments
      })

      const filteredUserCommentData = rawComment.filter((comment) => {
        return comment.commentId > lastCommentID
      })

      const userCommentData: any = {
        ...filteredUserCommentData,
      }


      statusLog(logSection, `Got user rawComment data: ${JSON.stringify(userCommentData)}`, scraperSessionId)
      return userCommentData
    } catch (err) {

      statusLog(logSection, 'An error occurred during a run.')

      // Throw the error up, allowing the user to handle this error himself.
      throw err;
    }
  }

  public getExperiences = async (scraperSessionId: number, profileUrl: string) => {
    const logSection = 'getExperiences'

    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn experiences: ${profileUrl}details/experience/`, scraperSessionId)

      await page.goto(`${profileUrl}details/experience/`, {
      });

      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn experience page loaded!', scraperSessionId)
      statusLog(logSection, 'Getting all the LinkedIn experience data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);
      statusLog(logSection, 'Parsing experience data...', scraperSessionId)

      await page.waitForTimeout(5000);
      
      const rawExperiences: any = await page.evaluate(() => {
        let data: RawExperience[] = []

        var experiences = document.querySelectorAll('.pvs-list__paged-list-item')
        for (var i=0; i<experiences.length; i++) {
          var exps = (<HTMLElement>experiences[i]).innerText.split('\n').filter(function(value, index, Arr) {
              return index % 2 == 0;
          });
          if (!exps[0].includes('Nothing to see')) {
            let title = exps[0];
            let company = exps[1];
            let dates = exps[2];
            let startDate = dates.split(" · ")[0].split(' - ')[0];
            let endDate = dates.split(" · ")[0].split(' - ')[1];
            let description = exps.slice(3).join(", ")

            data.push({
              title: title,
              company: company,
              startDate: startDate,
              endDate: endDate,
              description: description
            })
          }
        }
        return data
      })

      statusLog(logSection, `Got user rawExperience data: ${JSON.stringify(rawExperiences)}`, scraperSessionId)
      
      
      const experiences: Experience[] = {
        ...rawExperiences
      }
      return experiences

    }
    catch (err) {

      statusLog(logSection, 'An error occurred during a run.')

      // Throw the error up, allowing the user to handle this error himself.
      throw err;
    }
  }

  public getSkills = async (scraperSessionId: number, profileUrl: string) => {
    const logSection = 'getSkills'

    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn skills: ${profileUrl}details/skills/`, scraperSessionId)

      await page.goto(`${profileUrl}details/skills/`, {
      });

      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn skills page loaded!', scraperSessionId)
      statusLog(logSection, 'Getting all the LinkedIn skills data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);
      statusLog(logSection, 'Parsing skills data...', scraperSessionId)

      await page.waitForTimeout(5000);
      
      const skills: any = await page.evaluate(() => {
        let data: Skill[] = []

        var skills = document.querySelectorAll('[data-field="skill_page_skill_topic"]')
        for (var i=0; i<skills.length; i++) {
            if ((<HTMLElement>skills[i]).innerText.split('\n')[0]!='') {
              data.push({
                skillName: (<HTMLElement>skills[i]).innerText.split('\n')[0]
              })
            }
        }
        return data
      })

      statusLog(logSection, `Got user skill data: ${JSON.stringify(skills)}`, scraperSessionId)
     
      return skills
    }
    catch (err) {

      statusLog(logSection, 'An error occurred during a run.')

      // Throw the error up, allowing the user to handle this error himself.
      throw err;
    }
  }


  public getVolunteerings = async (scraperSessionId: number, profileUrl: string) => {
    const logSection = 'getVolunteerings'

    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn skills: ${profileUrl}details/volunteering-experiences/`, scraperSessionId)

      await page.goto(`${profileUrl}details/volunteering-experiences/`, {
      });

      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn volunteering page loaded!', scraperSessionId)
      statusLog(logSection, 'Getting all the LinkedIn volunteering data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);
      statusLog(logSection, 'Parsing volunteering data...', scraperSessionId)

      await page.waitForTimeout(5000);
      
      const volunteerings: any = await page.evaluate(() => {
        let data: Volunteering[] = []

        var volunteerings = document.querySelectorAll('.pvs-list__paged-list-item')
        for (var i=0; i<volunteerings.length; i++) {
          var vols = (<HTMLElement>volunteerings[i]).innerText.split('\n').filter(function(value, index, Arr) {
              return index % 2 == 0;
          });
          if (!vols[0].includes('Nothing to see')) {
            let title = vols[0];
            let company = vols[1];
            let dates = vols[2];
            let startDate = dates.split(" · ")[0].split(' - ')[0];
            let endDate = dates.split(" · ")[0].split(' - ')[1];
            let description = vols.slice(3).join(", ");

            data.push({
              title: title,
              company: company,
              startDate: startDate,
              endDate: endDate,
              description: description
            })
          }
        }
        return data
      })

      statusLog(logSection, `Got user volunteering data: ${JSON.stringify(volunteerings)}`, scraperSessionId)
     
      return volunteerings
    }
    catch (err) {

      statusLog(logSection, 'An error occurred during a run.')

      throw err;
    }
  }


  public getHonors = async (scraperSessionId: number, profileUrl: string) => {
    const logSection = 'getHonors'

    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn skills: ${profileUrl}details/honors/`, scraperSessionId)

      await page.goto(`${profileUrl}details/honors/`, {
      });

      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn honors page loaded!', scraperSessionId)
      statusLog(logSection, 'Getting all the LinkedIn honors data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);
      statusLog(logSection, 'Parsing honors data...', scraperSessionId)

      await page.waitForTimeout(5000);
      
      const honors: any = await page.evaluate(() => {
        let data: Honor[] = []

        var honors = document.querySelectorAll('.pvs-list__paged-list-item')
        for (var i=0; i<honors.length; i++) {
          var hons = (<HTMLElement>honors[i]).innerText.split('\n').filter(function(value, index, Arr) {
              return index % 2 == 0;
          });
          if (!hons[0].includes('Nothing to see')) {
            let title = hons[0];
            let company = hons[1].split(" · ")[0];
            let date = hons[1].split(" · ")[1];
            let description = hons.slice(2).join(", ");

            data.push({
              title: title,
              company: company,
              date: date,
              description: description
            })
          }
        }
        return data
      })

      statusLog(logSection, `Got user honor data: ${JSON.stringify(honors)}`, scraperSessionId)
     
      return honors
    }
    catch (err) {

      statusLog(logSection, 'An error occurred during a run.')

      throw err;
    }
  }
  /**
   * Method to scrape a user profile.
   */
  public run = async (profileUrl: string, options?: ScraperHistoryMemory) => {
    const logSection = 'run'

    const lastPostID = options?.lastPostID || 0
    const lastCommentID = options?.lastCommentID || 0

    const scraperSessionId = new Date().getTime();

    if (!this.browser) {
      throw new Error('Browser is not set. Please run the setup method first.')
    }

    if (!profileUrl) {
      throw new Error('No profileUrl given.')
    }

    if (!profileUrl.includes('linkedin.com/')) {
      throw new Error('The given URL to scrape is not a linkedin.com url.')
    }

    try {
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn profile: ${profileUrl}`, scraperSessionId)

      await page.goto(profileUrl, {
        // Use "networkidl2" here and not "domcontentloaded". 
        // As with "domcontentloaded" some elements might not be loaded correctly, resulting in missing data.
      });

      await page.waitForTimeout(5000)

      statusLog(logSection, 'LinkedIn profile page loaded!', scraperSessionId)

      statusLog(logSection, 'Getting all the LinkedIn profile data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);

      statusLog(logSection, 'Parsing profile data...', scraperSessionId)

      const rawUserProfilePageData : any = await page.evaluate(() => {
        const url = window.location.href

        const fullName = document.querySelector('.text-heading-xlarge.inline.t-24.v-align-middle.break-words')?.textContent || "";
        const pronouns = document.querySelector('.text-body-small.v-align-middle.break-words.t-black--light')?.textContent || "";
        const title = document.querySelector('.text-body-medium.break-words')?.textContent || "";
        const location = document.querySelector('.text-body-small.inline.t-black--light.break-words')?.textContent || "";
        const about = document.querySelector('.display-flex.ph5.pv3 div div div span')?.textContent || "";

        var photo = "";
        if (document.querySelector(".evi-image.ember-view.profile-photo-edit__preview")) {
          photo = (<HTMLImageElement>document.querySelector(".evi-image.ember-view.profile-photo-edit__preview")).src;
        }

      let raw_profile: RawProfile = {
          fullName,
          pronouns,
          title,
          location,
          about,
          photo,
          url
      };
      
      let raw_education: RawEducation[] = [];
      let raw_license: RawLicense[] = [];
      let raw_language: RawLanguage[] = [];

      const items = document.querySelectorAll('.artdeco-list__item');
      
      for (let i = 0; i < items.length; i++) {

        const top = items[i].parentElement?.parentElement?.previousElementSibling;
        if (top) {
          const title = top.textContent!.trim();

          if (title.includes("Education")) {
              const schoolName = items[i].querySelector<HTMLElement>('.display-flex.flex-wrap.align-items-center.full-height')?.innerText.split('\n')[0] || null;
              var degreeName = "";
              if (items[i].querySelector('.t-14.t-normal')) {
                degreeName = items[i].querySelector<HTMLElement>('.t-14.t-normal')?.innerText.split('\n')[0] || "";
              }
              var dates = "";
              if (items[i].querySelector('.pvs-entity__caption-wrapper')) {
                dates = items[i].querySelector<HTMLElement>('.pvs-entity__caption-wrapper')?.innerText.split('\n')[0] || "";
              }
              const startDate = (dates != "") && dates.split(" - ")[0] || null;
              const endDate = (dates != "") && dates.split(" - ")[1] || null;

              raw_education.push({
                schoolName,
                degreeName,
                startDate,
                endDate
              })

          }
          else if (title.includes("Licenses & certifications")) {
              const licenseName = items[i].querySelector<HTMLElement>('.display-flex.flex-wrap.align-items-center.full-height')?.innerText.split('\n')[0] || null;
              var licenseBody = "";
              if (items[i].querySelector('.t-14.t-normal')) {
                licenseBody = items[i].querySelector<HTMLElement>('.t-14.t-normal')?.innerText.split('\n')[0] || "";
              }

              raw_license.push({
                licenseName,
                licenseBody
              })

          }
          else if (title.includes("Languages")) {
            const languageName = items[i].querySelector<HTMLElement>('.display-flex.flex-wrap.align-items-center.full-height')?.innerText.split('\n')[0] || null;
            const languageLevel = items[i].querySelector<HTMLElement>('.t-14.t-normal.t-black--light')?.innerText.split('\n')[0] || null;

            raw_language.push({
              languageName,
              languageLevel
            })
          }
        }
      }
      return {
        raw_profile: raw_profile,
        raw_education: raw_education, 
        raw_license: raw_license, 
        raw_language: raw_language
      }
    });

      const rawUserProfileData = rawUserProfilePageData['raw_profile'];
      const rawEducationData = rawUserProfilePageData['raw_education'];
      const rawLicenseData = rawUserProfilePageData['raw_license'];
      const rawLanguageData = rawUserProfilePageData['raw_language'];

      statusLog(logSection, `rawUserProfileData: ${JSON.stringify(rawUserProfileData)}`, scraperSessionId)
      statusLog(logSection, `rawEducationData: ${JSON.stringify(rawEducationData)}`, scraperSessionId)
      statusLog(logSection, `rawLicenseData: ${JSON.stringify(rawLicenseData)}`, scraperSessionId)
      statusLog(logSection, `rawLanguageData: ${JSON.stringify(rawLanguageData)}`, scraperSessionId)


      const userProfile: Profile = {
        ...rawUserProfileData,
        fullName: getCleanText(rawUserProfileData.fullName),
        pronouns: getCleanText(rawUserProfileData.pronouns),
        title: getCleanText(rawUserProfileData.title),
        photo: rawUserProfileData.photo,
        location: rawUserProfileData.location ? getLocationFromText(rawUserProfileData.location) : null,
        about: getCleanText(rawUserProfileData.about),
      }

      statusLog(logSection, `Got user profile data: ${JSON.stringify(userProfile)}`, scraperSessionId)
      
      const education: Education[] = rawEducationData.map(rawEducation => {
        const startDate = formatDate(rawEducation.startDate)
        const endDate = formatDate(rawEducation.endDate)

        return {
          ...rawEducation,
          schoolName: getCleanText(rawEducation.schoolName),
          degreeName: getCleanText(rawEducation.degreeName),
          startDate,
          endDate,
          durationInDays: getDurationInDays(startDate, endDate),
        }
      })
      statusLog(logSection, `Got education data: ${JSON.stringify(education)}`, scraperSessionId)

      const license: License[] = rawLicenseData.map(rawLicense => {
        return {
          // ...rawLicense,
          licenseName: getCleanText(rawLicense.licenseName),
          licenseBody: getCleanText(rawLicense.licenseBody),
        }
      })
      statusLog(logSection, `Got License & Cert data: ${JSON.stringify(license)}`, scraperSessionId)


      const language: Language[] = rawLanguageData.map(rawLanguage => {
        return {
          // ...rawLicense,
          languageName: getCleanText(rawLanguage.languageName),
          languageLevel: getCleanText(rawLanguage.languageLevel),
        }
      })
      statusLog(logSection, `Got Language data: ${JSON.stringify(language)}`, scraperSessionId)

      statusLog(logSection, `Done! Returned profile details for: ${profileUrl}`, scraperSessionId)

      statusLog(logSection, `Parsing experience data...`, scraperSessionId)
      const experiences = await this.getExperiences(scraperSessionId, profileUrl);
      console.log("# EXPERIENCES #", experiences)

      statusLog(logSection, `Parsing skills data...`, scraperSessionId)
      const skills = await this.getSkills(scraperSessionId, profileUrl);
      console.log("# SKILLS #", skills)

      statusLog(logSection, `Parsing volunteering data...`, scraperSessionId)
      const volunteerings = await this.getVolunteerings(scraperSessionId, profileUrl);
      console.log("# VOLUNTEERING #", volunteerings)

      statusLog(logSection, `Parsing honors data...`, scraperSessionId)
      const honors = await this.getHonors(scraperSessionId, profileUrl);
      console.log("# HONORS #", honors)

      statusLog(logSection, `Parsing post data...`, scraperSessionId)
      const posts = await this.getPosts(scraperSessionId, profileUrl, lastPostID);
      console.log("# POSTS #", posts)

      statusLog(logSection, `Parsing comment data...`, scraperSessionId)
      const comments = await this.getComments(scraperSessionId, profileUrl, lastCommentID);
      console.log("# COMMENTS #", comments)

      

      if (!this.options.keepAlive) {
        statusLog(logSection, 'Not keeping the session alive.')

        await this.close(page)

        statusLog(logSection, 'Done. Puppeteer is closed.')
      } else {
        statusLog(logSection, 'Done. Puppeteer is being kept alive in memory.')

        await page.close()
      }

      return {
        userProfile,
        experiences,
        education,
        skills,
        volunteerings,
        posts,
        comments
      }
    } catch (err) {
      // Kill Puppeteer
      await this.close()

      statusLog(logSection, 'An error occurred during a run.')
      throw err;
    }
  }
}
