import got, { Got } from 'got';
import { HttpsProxyAgent } from 'hpagent';
import { Agent, AgentOptions } from 'https';
import { Key as RSAKey } from 'node-bignumber';
import PQueue from 'p-queue';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import SteamTotp from 'steam-totp';
import { CookieJar } from 'tough-cookie';

import { Confirmation } from './interfaces/confirmation.interface';
import { Session } from './interfaces/session.interface';

export class Bot {
  public readonly name: string;
  public readonly proxy: string | null;
  public readonly session: Session;
  public steamid: string | null = null;

  private readonly cache: Map<string, any> = new Map();

  private readonly cookieJar: CookieJar = new CookieJar();
  private readonly httpAgent: Agent | HttpsProxyAgent;
  private readonly httpClient: Got;

  private sessionid: string | null = null;
  private accessToken: string | null = null;
  private mobileDeviceid: string | null = null;

  constructor(options: { name: string; session: Session }, proxy?: string) {
    this.name = options.name;
    this.proxy = proxy || null;
    this.session = options.session;

    this.httpAgent = this.createHttpAgent();
    this.httpClient = this.createHttpClient();
  }

  public async start() {
    try {
      await this.refreshSession();
      await this.retrieveMobileDeviceid();
    } catch (error) {
      this.stop();
      throw new Error('Failed to start bot', { cause: error });
    }
  }

  public stop() {
    this.cache.clear();
    this.httpAgent.destroy();
  }

  public async startEmailChange() {
    try {
      const { url } = await this.httpClient.get('https://help.steampowered.com/en/wizard/HelpChangeEmail/');
      const params = Object.fromEntries(new URL(url).searchParams);

      if (!['s', 'account', 'issueid'].every((key) => params[key])) throw new Error('Bad server response');
      if (params.issueid !== '409') throw new Error('Bad server response');

      this.setRecoveryParams(params);

      await this.requestRecoveryCode();
      await this.confirmRecoveryCode();
      await this.verifyRecoveryCode();
      await this.verifyPassword();
    } catch (error) {
      throw new Error('Failed to start email change', { cause: error });
    }
  }

  public async applyEmailChange(email: string) {
    try {
      const constants = { reset: 2, lost: 2 };

      const params = this.getRecoveryParams<{ s: string; account: string; issueid: string }>();

      const response = await this.httpClient
        .post('https://help.steampowered.com/en/wizard/AjaxAccountRecoveryChangeEmail/', {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer:
              'https://help.steampowered.com/en/wizard/HelpWithLoginInfoReset/' +
              `?s=${params.s}` +
              `&account=${params.account}` +
              `&reset=${constants.reset}` +
              `&lost=${constants.lost}`,
          },
          form: {
            sessionid: this.sessionid,
            wizard_ajax: 1,
            gamepad: 0,
            s: params.s,
            account: params.account,
            email: email,
          },
        })
        .json<{ hash?: string; errorMsg?: string; show_confirmation?: boolean }>();

      if (!response.show_confirmation || response.errorMsg) throw new Error(response.errorMsg || 'Bad server response');
    } catch (error) {
      throw new Error('Failed to apply email change', { cause: error });
    }
  }

  public async finishEmailChange(email: string, code: string) {
    try {
      const constants = { reset: 2, lost: 2 };

      const params = this.getRecoveryParams<{ s: string; account: string; issueid: string }>();

      const response = await this.httpClient
        .post('https://help.steampowered.com/en/wizard/AjaxAccountRecoveryConfirmChangeEmail/', {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer:
              'https://help.steampowered.com/en/wizard/HelpWithLoginInfoReset/' +
              `?s=${params.s}` +
              `&account=${params.account}` +
              `&reset=${constants.reset}` +
              `&lost=${constants.lost}`,
          },
          form: {
            sessionid: this.sessionid,
            wizard_ajax: 1,
            gamepad: 0,
            s: params.s,
            account: params.account,
            email: email,
            email_change_code: code,
          },
        })
        .json<{ hash?: string; errorMsg?: string }>();

      if (response.errorMsg) throw new Error(response.errorMsg || 'Bad server response');
    } catch (error) {
      throw new Error('Failed to finish email change', { cause: error });
    }
  }

  private async requestRecoveryCode() {
    try {
      const constants = { reset: 2, lost: 0, method: 8 };

      const params = this.getRecoveryParams<{ s: string; account: string; issueid: string }>();

      const response = await this.httpClient
        .post('https://help.steampowered.com/en/wizard/AjaxSendAccountRecoveryCode', {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer:
              'https://help.steampowered.com/en/wizard/HelpWithLoginInfoEnterCode' +
              `?s=${params.s}` +
              `&account=${params.account}` +
              `&reset=${constants.reset}` +
              `&lost=${constants.lost}` +
              `&issueid=${params.issueid}`,
          },
          form: {
            sessionid: this.sessionid,
            wizard_ajax: 1,
            gamepad: 0,
            s: params.s,
            method: constants.method,
            link: '',
          },
        })
        .json<{ success: boolean; errorMsg?: string }>();

      if (!response.success) throw new Error(response.errorMsg || 'Bad server response');
    } catch (error) {
      throw new Error('Failed to request recovery code', { cause: error });
    }
  }

  private async confirmRecoveryCode() {
    try {
      const params = this.getRecoveryParams<{ s: string }>();

      const confirmation = (await this.fetchMobileConfirmations()).find((conf) => conf.object === params.s);
      if (!confirmation) throw new Error('Mobile confirmation not found');

      await this.acceptMobileConfirmation(confirmation);
    } catch (error) {
      throw new Error('Failed to confirm recovery code', { cause: error });
    }
  }

  private async verifyRecoveryCode() {
    try {
      const constants = { reset: 2, lost: 0, method: 8 };

      const params = this.getRecoveryParams<{ s: string; account: string; issueid: string }>();

      const response = await this.httpClient
        .get('https://help.steampowered.com/en/wizard/AjaxVerifyAccountRecoveryCode', {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer:
              'https://help.steampowered.com/en/wizard/HelpWithLoginInfoEnterCode' +
              `?s=${params.s}` +
              `&account=${params.account}` +
              `&reset=${constants.reset}` +
              `&lost=${constants.lost}` +
              `&issueid=${params.issueid}`,
          },
          searchParams: {
            code: '',
            s: params.s,
            reset: constants.reset,
            lost: constants.lost,
            method: constants.method,
            issueid: params.issueid,
            sessionid: this.sessionid,
            wizard_ajax: 1,
            gamepad: 0,
          },
        })
        .json<{ hash?: string; errorMsg?: string }>();

      if (response.errorMsg) throw new Error(response.errorMsg || 'Bad server response');
    } catch (error) {
      throw new Error('Failed to verify recovery code', { cause: error });
    }
  }

  private async verifyPassword() {
    try {
      const constants = { reset: 2, lost: 2 };

      const params = this.getRecoveryParams<{ s: string; account: string; issueid: string }>();

      const password = await this.encryptPassword();

      const response = await this.httpClient
        .post('https://help.steampowered.com/en/wizard/AjaxAccountRecoveryVerifyPassword/', {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer:
              'https://help.steampowered.com/en/wizard/HelpWithLoginInfoVerifyPassword/' +
              `?s=${params.s}` +
              `&account=${params.account}` +
              `&reset=${constants.reset}` +
              `&lost=${constants.lost}` +
              `&issueid=${params.issueid}`,
          },
          form: {
            sessionid: this.sessionid,
            s: params.s,
            lost: constants.lost,
            reset: constants.reset,
            password: password.value,
            rsatimestamp: password.rsa.timestamp,
          },
        })
        .json<{ hash?: string; errorMsg?: string }>();

      if (response.errorMsg) throw new Error(response.errorMsg || 'Bad server response');
    } catch (error) {
      throw new Error('Failed to verify password', { cause: error });
    }
  }

  private async encryptPassword() {
    try {
      const rsa = await this.fetchRsaEncryptionInfo();
      const key = new RSAKey();

      key.setPublic(rsa.mod, rsa.exp);
      const encryption = key.encrypt(this.session.Password);

      return { value: Buffer.from(encryption, 'hex').toString('base64'), rsa };
    } catch (error) {
      throw new Error('Failed to encrypt password', { cause: error });
    }
  }

  private async fetchRsaEncryptionInfo() {
    try {
      const constants = { reset: 2, lost: 2 };

      const params = this.getRecoveryParams<{ s: string; account: string; issueid: string }>();

      const response = await this.httpClient
        .post('https://help.steampowered.com/en/login/getrsakey/', {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer:
              'https://help.steampowered.com/en/wizard/HelpWithLoginInfoVerifyPassword/' +
              `?s=${params.s}` +
              `&account=${params.account}` +
              `&reset=${constants.reset}` +
              `&lost=${constants.lost}` +
              `&issueid=${params.issueid}`,
          },
          form: {
            sessionid: this.sessionid,
            username: this.session.Username,
          },
        })
        .json<{ success: boolean; publickey_mod: string; publickey_exp: string; timestamp: number }>();

      if (!response.success) throw new Error('Bad server response');

      return { mod: response.publickey_mod, exp: response.publickey_exp, timestamp: response.timestamp };
    } catch (error) {
      throw new Error('Failed to fetch rsa encryption info', { cause: error });
    }
  }

  private async fetchMobileConfirmations() {
    try {
      const tag = 'list';
      const time = SteamTotp.time();

      const response = await this.httpClient
        .get('https://steamcommunity.com/mobileconf/getlist', {
          searchParams: {
            p: this.mobileDeviceid,
            a: this.steamid,
            k: SteamTotp.getConfirmationKey(this.session.IdentitySecret, time, tag),
            t: time,
            m: 'react',
            tag: tag,
          },
        })
        .json<{
          success: boolean;
          message?: string;
          detail?: string;
          conf?: { id: string; nonce: string; type: number; creator_id: string }[];
        }>();

      if (!response.success || !response.conf) {
        const message = response.detail || response.message || 'Bad server response';
        throw new Error(message);
      }

      const confirmations: Confirmation[] = response.conf.map((conf) => {
        const confirmation: Confirmation = {
          id: conf.id,
          key: conf.nonce,
          type: conf.type,
          object: conf.creator_id,
        };

        return confirmation;
      });

      return confirmations;
    } catch (error) {
      throw new Error('Failed to fetch mobile confirmations', { cause: error });
    }
  }

  private async acceptMobileConfirmation(confirmation: Confirmation) {
    try {
      const time: number = SteamTotp.time();

      const op: 'allow' | 'cancel' = 'allow';
      const tag: 'accept' | 'reject' = 'accept';

      const response = await this.httpClient
        .get('https://steamcommunity.com/mobileconf/ajaxop', {
          searchParams: {
            p: this.mobileDeviceid,
            a: this.steamid,
            k: SteamTotp.getConfirmationKey(this.session.IdentitySecret, time, tag),
            t: time,
            m: 'react',
            tag: tag,
            cid: confirmation.id,
            ck: confirmation.key,
            op: op,
          },
        })
        .json<{ success: boolean; message?: string; detail?: string }>();

      if (!response.success) {
        const message = response.detail || response.message || 'Bad server response';
        throw new Error(message);
      }
    } catch (error) {
      throw new Error('Failed to accept mobile confirmation', { cause: error });
    }
  }

  private getRecoveryParams<T>(): T {
    if (!this.cache.has('recovery:params')) throw new Error('Recovery params not found');

    return this.cache.get('recovery:params');
  }

  private setRecoveryParams(params: Record<string, any>) {
    this.cache.set('recovery:params', params);
  }

  private async retrieveMobileDeviceid() {
    try {
      const response = await this.httpClient.post('https://api.steampowered.com/ITwoFactorService/QueryStatus/v1/', {
        searchParams: { access_token: this.accessToken, steamid: this.steamid },
        responseType: 'json',
      });

      const eResult = +response.headers['x-eresult'];
      const eMessage = response.headers['x-error_message'];
      if (eResult !== 1) throw new Error(`Steam error: ${eMessage || eResult || 'Bad server response'}`);

      const { response: data } = response.body as { response: { device_identifier: string } };
      if (!data.device_identifier) throw new Error('Device identifier not found');

      this.mobileDeviceid = data.device_identifier;
    } catch (error) {
      throw new Error('Failed to retrieve mobile deviceid', { cause: error });
    }
  }

  private async refreshSession() {
    const session = new LoginSession(EAuthTokenPlatformType.MobileApp, { agent: this.httpAgent });
    session.refreshToken = this.session.MobileRefreshToken;

    try {
      let cookies = await session.getWebCookies();
      cookies = cookies.filter((cookie) => !cookie.startsWith('Steam_Language='));

      cookies.push('Steam_Language=english');
      cookies.push('timezoneOffset=0,0');

      const loginSecureCookie = cookies.find((cookie) => cookie.startsWith('steamLoginSecure'));
      if (!loginSecureCookie) throw new Error('Login secure cookie not found');

      const [steamid, accessToken] = decodeURIComponent(loginSecureCookie.split('=')[1]).split('||');
      this.steamid = steamid;
      this.accessToken = accessToken;

      const sessionid = cookies.find((cookie) => cookie.startsWith('sessionid')).split('=')[1];
      this.sessionid = sessionid;

      this.cookieJar.removeAllCookiesSync();
      for (const cookie of cookies) {
        this.cookieJar.setCookieSync(cookie, 'https://steamcommunity.com');
        this.cookieJar.setCookieSync(cookie, 'https://help.steampowered.com');
        this.cookieJar.setCookieSync(cookie, 'https://store.steampowered.com');
        this.cookieJar.setCookieSync(cookie, 'https://checkout.steampowered.com');
      }
    } catch (error) {
      throw new Error('Failed to refresh session', { cause: error });
    }
  }

  private createHttpAgent() {
    const options: AgentOptions = { keepAlive: true, timeout: 65000, maxSockets: 50 };

    return this.proxy ? new HttpsProxyAgent({ proxy: this.proxy, ...options }) : new Agent(options);
  }

  private createHttpClient() {
    const queue = new PQueue({ interval: 500, intervalCap: 1 });

    const client = got.extend({
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      agent: { https: this.httpAgent },
      hooks: { beforeRequest: [() => queue.add(() => {})] },
      timeout: 50000,
      cookieJar: this.cookieJar,
    });

    return client;
  }
}
