/**
 * /users
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @version 1.0.0.
 * @license MIT
 **/

'use strict';

const async = require('async');
const uuid  = require('node-uuid');
const debug = require('debug')('route:users');

module.exports = (Router, dbctl) => {
  const Auth = require('../../lib/auth.js');
  let auth   = new Auth(dbctl);

  Router.get('/', (req, res) => {
    return res.send({
      error: "invalid_route"
    });
  });

  Router.post('/new', (req, res) => {
    let REQ = req.body;

    if(!REQ.username || !REQ.email || !REQ.class || !REQ.password) {
      return res.error(400);
    }

    REQ.username = REQ.username.toLowerCase();

    async.waterfall([
      // Get the SCRYPT hash.
      (next) => {
        auth.generateHash(REQ.password)
        .then(result => {
          debug('auth:hash', 'generated scrypt hash.')
          return next(false, result.toString('hex'));
        }, err => {
          debug('auth:hash', 'scrypt hash generation failed');
          return next(err);
        });
      },

      // Insert into the DB
      (hash, next) => {
        const SECRET = uuid.v4();
        const PUBLIC = uuid.v4();

        debug('auth:api', 'generated UUIDs');

        dbctl.post('users', {
          username: REQ.username,
          email:    REQ.email,
          class:    REQ.class,
          password: hash,
          api: {
            public: PUBLIC,
            secret: SECRET
          }
        })
          .then(results => {
            debug('auth:db', 'successfully added to the database');
            return next();
          })
          .fail(err => {
            debug('auth:db', 'error:', err);
            return next(err);
          })
      }
    ], err => {
      if(err) {
        return res.error(501, 'FAILED_TO_CREATE_USER');
      }

      return res.success('USER_CREATED');
    });
  });

  Router.post('/delete', (req, res) => {
    let REQ = req.body;

    if(!REQ.username || !REQ.password) {
      return res.error(400)
    }

    async.waterfall([
      // Find the User by Username.
      (next) => {
        auth.getUserObject(REQ.username)
        .then(result => {
          let user = result[0].value;
          user.key = result[0].path.key;

          debug('remove:db', 'fetched secrets');

          return next(false, user)
        })
        .catch(err => {
          console.log(err);
          return next(err);
        });
      },

      // Check if the password is valid.
      (user, next) => {
        auth.isValid(REQ.password, user.password)
        .then(valid => {
          if(!valid) {
            return next('Invalid Auth')
          }

          debug('remove:authcheck', 'is VALID');
          return next(false, user);
        })
        .catch(err => {
          return next(err);
        });
      },

      // delete the user's key.
      (user, next) => {
        dbctl.remove('users', user.key, true)
        .then(success => {
          return next();
        })
        .fail(err => {
          return next('FAILED_TO_REMOVE_USER_OBJ');
        })
      }
    ], err => {
      if(err) {
        if(err === 'MATCHED_NONE') {
          return res.error(400, 'USER_NOT_FOUND');
        }

        return res.error(501, 'FAILED_TO_DELETE_USER');
      }

      return res.success('USER_DELETED');
    })
  });

  Router.post('/authflow', (req, res) => {
    let REQ = req.body;

    if(!REQ.username || !REQ.password) {
      return res.error(400)
    }

    async.waterfall([
      // Find the User by Username.
      (next) => {
        auth.getUserObject(REQ.username)
        .then(result => {
          let user = result[0].value;

          let keys = {
            p: user.api.public,
            passphrase: user.password,
            s: user.api.secret
          }

          return next(false, keys)
        })
        .catch(err => {
          console.log(err);
          return next(err);
        });
      },

      // Check if the password is valid.
      (keys, next) => {
        auth.isValid(REQ.password, keys.passphrase)
        .then(valid => {
          if(!valid) {
            return next('Invalid Auth')
          }

          debug('authflow:authcheck', 'is VALID');

          return next(false, keys);
        })
        .catch(err => {
          return next(err);
        });
      }
    ], (err, key) => {
      if(err) {
        debug('authflow:final', 'INVALID')
        return res.error('AUTHFLOW_INVALID');
      }

      return res.success({
        public: key.p,
        secret: key.s
      })
    });
  })

  Router.get('/list', (req, res) => {
    return dbctl.search('users', '*')
    .fail(err => {
      return res.error(501);
    })
    .then(results => {
      console.log('got results');

      let users = [];

      results.body.results.forEach(user => {
        let data = user.value;

        // push a new object to avoid using delete.
        users.push({
          username: data.username,
          email: data.email,
          class: data.class
        });
      });

      return res.success(users);
    });
  });

  return Router;
}
