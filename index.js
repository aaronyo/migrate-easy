#!/usr/bin/env node
'use strict';

var argv = require('yargs').argv,
    colors = require('colors'),
    _ = require('lodash'),
    _s = require('o3-sugar'),
    fs = require('fs'),
    Promise = require('bluebird'),
    dbeasy = require('dbeasy');

function run(db, migrationsDir, migrationsTable) {

  var migrator = require('dbeasy/migrator')(db);
  function getMigrationFiles(dir) {
    return _.map(_.sortBy(fs.readdirSync(dir)), function(filename) {
      return dir + '/' + filename;
    });
  }

  function loadMigrations(migrator, dir) {
    var migrations = getMigrationFiles(dir);
    return Promise.each(migrations, function(migrationPath) {
      return migrator.loadMigration(migrationPath);
    });
  }

  function redateCommands(migrations) {
    return _s.interleave(
      _.map(migrations, function(m) {
        return './run migrate redate ' + m.path;
      }),
      'sleep 1');
  }

  var commands = {
    'up': function() {
      return loadMigrations(migrator, migrationsDir)
        .then(function() {
          return migrator.up(migrationsTable);
        })
        .catch(function(err) {
          console.log(colors.red(err.stack));
          console.log('');
          console.log(colors.red('Run migrate check'));
          return 1;
        });
    },
    'new': function(argv) {
      var name = argv._[1];
      if (!name) {
        console.error('Migration name required');
        process.exit(1);
      }

      return migrator.createMigration(name, migrationsDir)
        .then(function(path) {
          console.log('Created:', path);
        });
    },
    'redate': function(argv) {
      var path = argv._[1];
      if (!path) {
        console.error('Migration path required');
        process.exit(1);
      }

      return migrator.redate(path)
        .then(function(newPath) {
          console.log('Moved to:', newPath);
        });
    },
    'check': function(argv) {
      var failOnPending = argv.f || argv.fail;

      return loadMigrations(migrator, migrationsDir)
        .then(function() {
          return migrator.getStatus(migrationsTable)
            .then(_.spread(function(migrations, hasPending, hasMissing) {
              var color = {
                'C': 'white',
                'P': 'green',
                'M': 'red'
              };

              console.log();
              console.log(
                colors[color['C']]('[C]ommitted'),
                colors[color['P']]('[P]ending'),
                colors[color['M']]('[M]issing')
              );
              console.log();

              if (hasPending || hasMissing) {
                console.log('Outstanding migrations:');
              } else {
                console.log('Migrations all caught up!');
              }
              console.log();

              _.each(migrations, function(migration) {
                var status =
                      (migration.isCommitted
                       ? 'C'
                       : (migration.candidateStatus === 'MISSING'
                          ? 'M'
                          : 'P' //PENDING
                         ));
                console.log(colors[color[status]]([
                  status + ': ' + migration.date,
                  migration.description
                ].join(', ')));
              });

              console.log();

              if (hasMissing) {
                console.log('COMMANDS FOR FIXING (be careful)');
                console.log('================================');
                console.log();
                console.log('Redate missing migrations');
                console.log('-------------------------');

                console.log(
                  redateCommands(
                    _.filter(migrations, {candidateStatus: 'MISSING'}))
                    .join('\n'));
                console.log();
              }

              if (hasMissing && hasPending) {
                console.log('(Optional) Redate pending migrations');
                console.log('------------------------------------');
                console.log(
                  redateCommands(
                    _.filter(migrations, {candidateStatus: 'PENDING'}))
                    .join('\n'));
                console.log();
              }

              if ((hasMissing || hasPending) && failOnPending) {
                return 1;
              }

            }));
        });
    },
    'help': function() {
      /*globals console:true*/
      console.log('Migration commands:', _.keys(commands).join(', '));
    }
  };

  function unalias(command) {
    return {
      'migrate': 'migrate:up'
    }[command] || command;
  }

  var command = commands[unalias(argv._[0] || 'help')];
  if (!command) {
    console.log('Command not found:', argv._[0]);
    process.exit(1);
  }
  var statusCode;
  return Promise.resolve(command(argv))
    .then(function(code) {
      statusCode = code;
    })
    .finally(function() {
      db.close();
      setTimeout(function() {
        process.exit(statusCode);
      }, 100);
    });
}

const db = dbeasy.client({
  url: process.env.DATABASE_URL,
  enableStore: true,
});

var migrationsDir = argv.dir || 'migrations';
var migrationsTable = argv.table || 'public.migrations';

run(db, migrationsDir, migrationsTable);
