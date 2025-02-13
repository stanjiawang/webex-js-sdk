import {camelCase} from 'lodash';
import PermissionError from '../common/errors/permission';
import {CONTROLS, HTTP_VERBS} from '../constants';
import MeetingRequest from '../meeting/request';
import LoggerProxy from '../common/logs/logger-proxy';
import {Control, Setting} from './enums';
import {ControlConfig} from './types';
import Util from './util';
import {CAN_SET, CAN_UNSET, ENABLED} from './constants';

/**
 * docs
 * https://sqbu-github.cisco.com/pages/WebExSquared/locus/guides/mute.html
 * https://confluence-eng-gpk2.cisco.com/conf/display/LOCUS/Hard+Mute+and+Audio+Privacy#HardMuteandAudioPrivacy-SelfMuteonEntry
 * https://confluence-eng-gpk2.cisco.com/conf/pages/viewpage.action?spaceKey=UC&title=WEBEX-124454%3A+UCF%3A+Hard+mute+support+for+Teams+joining+Webex+meeting
 * https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-180867
 * https://jira-eng-gpk2.cisco.com/jira/browse/SPARK-393351
 */

/**
 * @description ControlsOptionsManager is responsible for handling the behavior of participant controls when somebody joins a meeting
 * @export
 * @private
 * @class Recording
 */
export default class ControlsOptionsManager {
  /**
   * @instance
   * @type {MeetingRequest}
   * @private
   * @memberof ControlsOptionsManager
   */
  private request: MeetingRequest;

  /**
   * @instance
   * @type {Array}
   * @private
   * @memberof ControlsOptionsManager
   */
  private displayHints: Array<string> = [];

  /**
   * @instance
   * @type {string}
   * @private
   * @memberof ControlsOptionsManager
   */
  private locusUrl: string;

  /**
   * @param {MeetingRequest} request
   * @param {Object} options
   * @constructor
   * @memberof ControlsOptionsManager
   */
  constructor(
    request: MeetingRequest,
    options?: {
      locusUrl: string;
      displayHints?: Array<string>;
    }
  ) {
    this.initialize(request);
    this.set(options);
  }

  /**
   * @param {MeetingRequest} request
   * @returns {void}
   * @private
   * @memberof ControlsOptionsManager
   */
  private initialize(request: MeetingRequest) {
    this.request = request;
  }

  /**
   * @param {Object} options
   * @returns {void}
   * @public
   * @memberof ControlsOptionsManager
   */
  public set(options?: {locusUrl: string; displayHints?: Array<string>}) {
    this.extract(options);
  }

  /**
   * @param {string} url
   * @returns {void}
   * @public
   * @memberof ControlsOptionsManager
   */
  public setLocusUrl(url: string) {
    this.locusUrl = url;
  }

  /**
   * @param {Array} hints
   * @returns {void}
   * @public
   * @memberof ControlsOptionsManager
   */
  public setDisplayHints(hints: Array<string>) {
    this.displayHints = hints;
  }

  /**
   * @returns {string}
   * @public
   * @memberof ControlsOptionsManager
   */
  public getLocusUrl() {
    return this.locusUrl;
  }

  /**
   * @returns {Array}
   * @public
   * @memberof ControlsOptionsManager
   */
  public getDisplayHints() {
    return this.displayHints;
  }

  /**
   * @param {Object} options
   * @returns {void}
   * @private
   * @memberof ControlsOptionsManager
   */
  private extract(options?: {locusUrl: string; displayHints?: Array<string>}) {
    this.setDisplayHints(options?.displayHints);
    this.setLocusUrl(options?.locusUrl);
  }

  /**
   * Set controls for this meeting.
   *
   * @param {Array<ControlConfig>} controls - Spread Array of ControlConfigs
   * @returns {Promise<Array<any>>}- Promise resolving if the request was successful.
   */
  public update(...controls: Array<ControlConfig>) {
    const payloads = controls.map((control) => {
      if (!Object.keys(Control).includes(control.scope)) {
        throw new Error(
          `updating meeting control scope "${control.scope}" is not a supported scope`
        );
      }

      if (!Util.canUpdate(control, this.displayHints)) {
        throw new PermissionError(
          `updating meeting control scope "${control.scope}" not allowed, due to moderator property.`
        );
      }

      return {
        [control.scope]: control.properties,
      };
    });

    return payloads.reduce((previous, payload) => {
      return previous.then(() =>
        // @ts-ignore
        this.request.request({
          uri: `${this.locusUrl}/${CONTROLS}`,
          body: payload,
          method: HTTP_VERBS.PATCH,
        })
      );
    }, Promise.resolve());
  }

  /**
   * @param {Setting} setting
   * @private
   * @memberof ControlsOptionsManager
   * @returns {Promise}
   */
  private setControls(setting: {
    [Setting.muted]?: boolean;
    [Setting.disallowUnmute]?: boolean;
    [Setting.muteOnEntry]?: boolean;
    [Setting.roles]?: Array<string>;
  }): Promise<any> {
    LoggerProxy.logger.log(
      `ControlsOptionsManager:index#setControls --> ${JSON.stringify(setting)}`
    );

    const body: Record<string, any> = {};
    let error: PermissionError;

    let shouldSkipCheckToMergeBody = false;

    Object.entries(setting).forEach(([key, value]) => {
      if (
        !shouldSkipCheckToMergeBody &&
        value !== undefined &&
        !Util?.[`${value ? CAN_SET : CAN_UNSET}${key}`](this.displayHints)
      ) {
        error = new PermissionError(`${key} [${value}] not allowed, due to moderator property.`);
      }

      if (error) {
        return;
      }

      switch (key) {
        case Setting.muted:
          shouldSkipCheckToMergeBody = true;
          body.audio = body.audio
            ? {...body.audio, [camelCase(key)]: value}
            : {[camelCase(key)]: value};
          break;

        case Setting.disallowUnmute:
        case Setting.muteOnEntry:
          if (Object.keys(setting).includes(Setting.muted)) {
            body.audio = body.audio
              ? {...body.audio, [camelCase(key)]: value}
              : {[camelCase(key)]: value};
            body.audio[camelCase(key)] = value;
          } else {
            body[camelCase(key)] = {[ENABLED]: value};
          }
          break;

        case Setting.roles:
          if (Array.isArray(value)) {
            body.audio = body.audio
              ? {...body.audio, [camelCase(key)]: value}
              : {[camelCase(key)]: value};
          }
          break;

        default:
          error = new PermissionError(`${key} [${value}] not allowed, due to moderator property.`);
      }
    });

    if (error) {
      return Promise.reject(error);
    }

    // @ts-ignore
    return this.request.request({
      uri: `${this.locusUrl}/${CONTROLS}`,
      body,
      method: HTTP_VERBS.PATCH,
    });
  }

  /**
   * @public
   * @param {boolean} enabled
   * @memberof ControlsOptionsManager
   * @returns {Promise}
   */
  public setMuteOnEntry(enabled: boolean): Promise<any> {
    return this.setControls({[Setting.muteOnEntry]: enabled});
  }

  /**
   * @public
   * @param {boolean} enabled
   * @memberof ControlsOptionsManager
   * @returns {Promise}
   */
  public setDisallowUnmute(enabled: boolean): Promise<any> {
    return this.setControls({[Setting.disallowUnmute]: enabled});
  }

  /**
   * @public
   * @param {boolean} mutedEnabled
   * @param {boolean} disallowUnmuteEnabled
   * @param {boolean} muteOnEntryEnabled
   * @param {array} roles which should be muted
   * @memberof ControlsOptionsManager
   * @returns {Promise}
   */
  public setMuteAll(
    mutedEnabled: boolean,
    disallowUnmuteEnabled: boolean,
    muteOnEntryEnabled: boolean,
    roles: Array<string>
  ): Promise<any> {
    return this.setControls({
      [Setting.muted]: mutedEnabled,
      [Setting.disallowUnmute]: disallowUnmuteEnabled,
      [Setting.muteOnEntry]: muteOnEntryEnabled,
      [Setting.roles]: roles,
    });
  }
}
