/*!
 * Copyright (c) 2015-2020 Cisco Systems, Inc. See LICENSE file.
 */

import {registerPlugin} from '@webex/webex-core';

import Authorization from './authorization';
import config from './config';

const proxies = ['isAuthorizing', 'isAuthenticating'];

registerPlugin('authorization', Authorization, {
  config,
  proxies,
});

export {default, Events} from './authorization';
export {default as config} from './config';
