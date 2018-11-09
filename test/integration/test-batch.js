"use strict";

const base = require("../base.js");
const { assert } = require("chai");

const fs = require("fs");
const os = require("os");
const path = require("path");

describe("batch", () => {
  const fileName = path.join(os.tmpdir(), Math.random() + "tempBatchFile.txt");
  const bigFileName = path.join(os.tmpdir(), Math.random() + "tempBigBatchFile.txt");
  const testSize = 16 * 1024 * 1024 + 800; // more than one packet

  let maxAllowedSize, bigBuf;

  before(function(done) {
    shareConn
      .query("SELECT @@max_allowed_packet as t")
      .then(row => {
        maxAllowedSize = row[0].t;
        if (testSize < maxAllowedSize) {
          bigBuf = Buffer.alloc(testSize);
          for (let i = 0; i < testSize; i++) {
            bigBuf[i] = 97 + (i % 10);
          }
        }
        const buf = Buffer.from("abcdefghijkflmnopqrtuvwxyz🤘💪");
        fs.writeFile(fileName, buf, "utf8", function(err) {
          if (err) {
            done(err);
          } else {
            done();
          }
        });
      })
      .catch(done);
  });

  after(function() {
    fs.unlink(fileName, err => {});
    fs.unlink(bigFileName, err => {});
  });

  const simpleBatch = (useCompression, useBulk, done) => {
    base
      .createConnection({ compress: useCompression, bulk: useBulk, debug:true })
      .then(conn => {
        conn.query(
          "CREATE TABLE simpleBatch(id int, id2 int, id3 int, t varchar(128), d datetime, id4 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `simpleBatch` values (1, ?, 2, ?, ?, 3)", [
            [1, "john", new Date("2001-12-31 23:59:58")],
            [2, "jack", new Date("2020-12-31 23:59:59")]
          ])
          .then(res => {
            assert.equal(res.affectedRows, 2);
            conn
              .query("select * from `simpleBatch`")
              .then(res => {
                assert.deepEqual(res, [
                  {
                    id: 1,
                    id2: 1,
                    id3: 2,
                    t: "john",
                    d: new Date("2001-12-31 23:59:58"),
                    id4: 3
                  },
                  {
                    id: 1,
                    id2: 2,
                    id3: 2,
                    t: "jack",
                    d: new Date("2020-12-31 23:59:59"),
                    id4: 3
                  }
                ]);
                conn.query("DROP TABLE simpleBatch");
                conn.end();
                done();
              })
              .catch(err => {
                done(err);
              });
          });
      })
      .catch(done);
  };

  const simpleBatchErrorMsg = (compression, useBulk, done) => {
    base
      .createConnection({ trace: true, bulk: useBulk })
      .then(conn => {
        conn
          .batch("INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3)", [
            [1, "john"],
            [2, "jack"]
          ])
          .then(() => {
            done(new Error("must have thrown error !"));
          })
          .catch(err => {
            assert.isTrue(err != null);
            assert.isTrue(err.message.includes(" doesn't exist"));
            assert.isTrue(
              err.message.includes(
                "INSERT INTO simpleBatchErrorMsg values (1, ?, 2, ?, 3) - parameters:[[1,'john'],[2,'jack']]"
              )
            );
            assert.equal(err.errno, 1146);
            assert.equal(err.sqlState, "42S02");
            assert.equal(err.code, "ER_NO_SUCH_TABLE");
            conn.end();
            done();
          });
      })
      .catch(done);
  };

  const nonRewritableBatch = (useCompression, useBulk, done) => {
    base
      .createConnection({ compress: useCompression, bulk: useBulk, debug: useBulk  })
      .then(conn => {
        conn
          .batch("SELECT ? as id, ? as t", [[1, "john"], [2, "jack"]])
          .then(res => {
            if (useBulk && conn.info.isMariaDB() && conn.info.hasMinVersion(10, 2, 7)) {
              done(new Error("Must have thrown an exception"));
            } else {
              assert.deepEqual(res, [
                [
                  {
                    id: 1,
                    t: "john"
                  }
                ],
                [
                  {
                    id: 2,
                    t: "jack"
                  }
                ]
              ]);
              done();
            }
            conn.end();
          })
          .catch(err => {
            conn.end();
            if (useBulk & conn.info.isMariaDB() && conn.info.hasMinVersion(10, 2, 7)) {
              assert.isTrue(
                err.message.includes(
                  "This command is not supported in the prepared statement protocol yet"
                ),
                err.message
              );
              done();
            } else {
              done(err);
            }
          });
      })
      .catch(done);
  };

  const bigBatchWith16mMaxAllowedPacket = (useCompression, useBulk, done) => {
    base
      .createConnection({
        compress: useCompression,
        maxAllowedPacket: 16 * 1024 * 1024,
        bulk: useBulk
      })
      .then(conn => {
        conn.query("DROP TABLE IF EXISTS bigBatchWith16mMaxAllowedPacket");
        conn.query(
          "CREATE TABLE bigBatchWith16mMaxAllowedPacket(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4"
        );
        const values = [];
        for (let i = 0; i < 1000000; i++) {
          values.push([i, "abcdefghijkflmnopqrtuvwxyz🤘💪"]);
        }
        conn
          .batch("INSERT INTO `bigBatchWith16mMaxAllowedPacket` values (1, ?, 2, ?, 3)", values)
          .then(res => {
            assert.equal(res.affectedRows, 1000000);
          })
          .catch(done);
        let currRow = 0;
        conn
          .queryStream("select * from `bigBatchWith16mMaxAllowedPacket`")
          .on("error", err => {
            done(new Error("must not have thrown any error !"));
          })
          .on("data", row => {
            assert.deepEqual(row, {
              id: 1,
              id2: currRow,
              id3: 2,
              t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
              id4: 3
            });
            currRow++;
          })
          .on("end", () => {
            assert.equal(1000000, currRow);
            conn.query("DROP TABLE bigBatchWith16mMaxAllowedPacket");
            conn.end();
            done();
          });
      })
      .catch(done);
  };

  const bigBatchWith4mMaxAllowedPacket = (useCompression, useBulk, done) => {
    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE bigBatchWith4mMaxAllowedPacket(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4"
        );
        const values = [];
        for (let i = 0; i < 1000000; i++) {
          values.push([i, "abcdefghijkflmnopqrtuvwxyz🤘💪"]);
        }
        conn
          .batch("INSERT INTO `bigBatchWith4mMaxAllowedPacket` values (1, ?, 2, ?, 3)", values)
          .then(res => {
            assert.equal(res.affectedRows, 1000000);
          })
          .catch(done);
        let currRow = 0;
        conn
          .queryStream("select * from `bigBatchWith4mMaxAllowedPacket`")
          .on("error", err => {
            done(new Error("must not have thrown any error !"));
          })
          .on("data", row => {
            assert.deepEqual(row, {
              id: 1,
              id2: currRow,
              id3: 2,
              t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
              id4: 3
            });
            currRow++;
          })
          .on("end", () => {
            assert.equal(1000000, currRow);
            conn.query("DROP TABLE bigBatchWith4mMaxAllowedPacket");
            conn.end();
            done();
          });
      })
      .catch(done);
  };

  const bigBatchError = (useCompression, useBulk, done) => {
    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        const values = [];
        for (let i = 0; i < 1000000; i++) {
          values.push([i, "abcdefghijkflmnopqrtuvwxyz🤘💪"]);
        }
        conn
          .batch("INSERT INTO `bigBatchError` values (1, ?, 2, ?, 3)", values)
          .then(res => {
            done(new Error("must have thrown error !"));
          })
          .catch(err => {
            conn
              .query("select 1")
              .then(rows => {
                assert.deepEqual(rows, [{ "1": 1 }]);
                conn.end();
                done();
              })
              .catch(done);
          });
      })
      .catch(done);
  };

  const singleBigInsertWithoutMaxAllowedPacket = (useCompression, useBulk, done) => {
    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE singleBigInsertWithoutMaxAllowedPacket(id int, id2 int, id3 int, t longtext, id4 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `singleBigInsertWithoutMaxAllowedPacket` values (1, ?, 2, ?, 3)", [
            [1, bigBuf],
            [2, "john"]
          ])
          .then(res => {
            assert.equal(res.affectedRows, 2);
            conn
              .query("select * from `singleBigInsertWithoutMaxAllowedPacket`")
              .then(rows => {
                assert.deepEqual(rows, [
                  {
                    id: 1,
                    id2: 1,
                    id3: 2,
                    t: bigBuf.toString(),
                    id4: 3
                  },
                  {
                    id: 1,
                    id2: 2,
                    id3: 2,
                    t: "john",
                    id4: 3
                  }
                ]);
                conn.query("DROP TABLE singleBigInsertWithoutMaxAllowedPacket");
                conn.end();
                done();
              })
              .catch(done);
          })
          .catch(done);
      })
      .catch(done);
  };

  const batchWithStream = (useCompression, useBulk, done) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE batchWithStream(id int, id2 int, id3 int, t varchar(128), id4 int, id5 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `batchWithStream` values (1, ?, 2, ?, ?, 3)", [
            [1, stream1, 99],
            [2, stream2, 98]
          ])
          .then(res => {
            assert.equal(res.affectedRows, 2);
            conn.query("select * from `batchWithStream`").then(res => {
              assert.deepEqual(res, [
                {
                  id: 1,
                  id2: 1,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: 99,
                  id5: 3
                },
                {
                  id: 1,
                  id2: 2,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: 98,
                  id5: 3
                }
              ]);
              conn.query("DROP TABLE batchWithStream");
              conn.end();
              done();
            });
          })
          .catch(done);
      })
      .catch(done);
  };

  const batchErrorWithStream = (useCompression, useBulk, done) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        conn
          .batch("INSERT INTO batchErrorWithStream values (1, ?, 2, ?, ?, 3)", [
            [1, stream1, 99],
            [2, stream2, 98]
          ])
          .then(() => {
            done(new Error("must have thrown error !"));
          })
          .catch(err => {
            assert.isTrue(err != null);
            assert.isTrue(err.message.includes(" doesn't exist"));
            assert.isTrue(
              err.message.includes(
                "sql: INSERT INTO batchErrorWithStream values (1, ?, 2, ?, ?, 3) - parameters:[[1,[object Object],99],[2,[object Object],98]]"
              )
            );
            assert.equal(err.errno, 1146);
            assert.equal(err.sqlState, "42S02");
            assert.equal(err.code, "ER_NO_SUCH_TABLE");
            conn.end();
            done();
          });
      })
      .catch(done);
  };

  const bigBatchWithStreams = (useCompression, useBulk, done) => {
    const values = [];
    for (let i = 0; i < 1000000; i++) {
      if (i % 100000 === 0) values.push([i, fs.createReadStream(fileName), i * 2]);
      else values.push([i, "abcdefghijkflmnopqrtuvwxyz🤘💪", i * 2]);
    }

    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE bigBatchWithStreams(id int, id2 int, id3 int, t varchar(128), id4 int, id5 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `bigBatchWithStreams` values (1, ?, 2, ?, ?, 3)", values)
          .then(res => {
            assert.equal(res.affectedRows, 1000000);
            let currRow = 0;
            conn
              .queryStream("select * from `bigBatchWithStreams`")
              .on("error", err => {
                done(new Error("must not have thrown any error !"));
              })
              .on("data", row => {
                assert.deepEqual(row, {
                  id: 1,
                  id2: currRow,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: currRow * 2,
                  id5: 3
                });
                currRow++;
              })
              .on("end", () => {
                assert.equal(1000000, currRow);
                conn.query("DROP TABLE bigBatchWithStreams");
                conn.end();
                done();
              });
          })
          .catch(done);
      })
      .catch(done);
  };

  const bigBatchErrorWithStreams = (useCompression, useBulk, done) => {
    const values = [];
    for (let i = 0; i < 1000000; i++) {
      if (i % 100000 === 0) values.push([i, fs.createReadStream(fileName), i * 2]);
      else values.push([i, "abcdefghijkflmnopqrtuvwxyz🤘💪", i * 2]);
    }

    base
      .createConnection({ compress: useCompression, bulk: useBulk })
      .then(conn => {
        conn
          .batch("INSERT INTO `blabla` values (1, ?, 2, ?, ?, 3)", values)
          .then(res => {
            done(new Error("must have thrown error !"));
          })
          .catch(err => {
            conn
              .query("select 1")
              .then(rows => {
                assert.deepEqual(rows, [{ "1": 1 }]);
                conn.end();
                done();
              })
              .catch(done);
          });
      })
      .catch(done);
  };

  const simpleNamedPlaceHolders = (useBulk, done) => {
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE simpleNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `simpleNamedPlaceHolders` values (1, :param_1, 2, :param_2, 3)", [
            { param_1: 1, param_2: "john" },
            { param_1: 2, param_2: "jack" }
          ])
          .then(res => {
            assert.equal(res.affectedRows, 2);
            conn
              .query("select * from `simpleNamedPlaceHolders`")
              .then(res => {
                assert.deepEqual(res, [
                  {
                    id: 1,
                    id2: 1,
                    id3: 2,
                    t: "john",
                    id4: 3
                  },
                  {
                    id: 1,
                    id2: 2,
                    id3: 2,
                    t: "jack",
                    id4: 3
                  }
                ]);
                conn.query("DROP TABLE simpleNamedPlaceHolders");
                conn.end();
                done();
              })
              .catch(done);
          })
          .catch(done);
      })
      .catch(done);
  };

  const simpleNamedPlaceHoldersErr = (useBulk, done) => {
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn
          .batch("INSERT INTO blabla values (1, :param_1, 2, :param_2, 3)", [
            { param_1: 1, param_2: "john" },
            { param_1: 2, param_2: "jack" }
          ])
          .then(() => {
            done(new Error("must have thrown error !"));
          })
          .catch(err => {
            assert.isTrue(err != null);
            assert.isTrue(err.message.includes(" doesn't exist"));
            assert.isTrue(
              err.message.includes(
                "sql: INSERT INTO blabla values (1, :param_1, 2, :param_2, 3) - parameters:[{'param_1':1,'param_2':'john'},{'param_1':2,'param_2':'jack'}]"
              )
            );
            assert.equal(err.errno, 1146);
            assert.equal(err.sqlState, "42S02");
            assert.equal(err.code, "ER_NO_SUCH_TABLE");
            conn.end();
            done();
          });
      })
      .catch(done);
  };
  const nonRewritableHoldersErr = (useBulk, done) => {
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn
          .batch("SELECT :id2 as id, :id1 as t", [{ id2: 1, id1: "john" }, { id1: "jack", id2: 2 }])
          .then(res => {
            conn.end();
            if (useBulk & conn.info.isMariaDB() && conn.info.hasMinVersion(10, 2, 7)) {
              done(new Error("Must have thrown an exception"));
            } else {
              assert.deepEqual(res, [
                [
                  {
                    id: 1,
                    t: "john"
                  }
                ],
                [
                  {
                    id: 2,
                    t: "jack"
                  }
                ]
              ]);
              done();
            }
          })
          .catch(err => {
            conn.end();
            if (useBulk & conn.info.isMariaDB() && conn.info.hasMinVersion(10, 2, 7)) {
              assert.isTrue(
                err.message.includes(
                  "This command is not supported in the prepared statement protocol yet"
                )
              );
              done();
            } else {
              done(err);
            }
          });
      })
      .catch(done);
  };

  const more16MNamedPlaceHolders = function(useBulk, done) {
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE more16MNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int) CHARSET utf8mb4"
        );
        const values = [];
        for (let i = 0; i < 1000000; i++) {
          values.push({ id1: i, id2: "abcdefghijkflmnopqrtuvwxyz🤘💪" });
        }
        conn
          .batch("INSERT INTO `more16MNamedPlaceHolders` values (1, :id1, 2, :id2, 3)", values)
          .then(res => {
            assert.equal(res.affectedRows, 1000000);

            let currRow = 0;
            conn
              .queryStream("select * from `more16MNamedPlaceHolders`")
              .on("error", err => {
                done(new Error("must not have thrown any error !"));
              })
              .on("data", row => {
                assert.deepEqual(row, {
                  id: 1,
                  id2: currRow,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: 3
                });
                currRow++;
              })
              .on("end", () => {
                assert.equal(1000000, currRow);
                conn.query("DROP TABLE more16MNamedPlaceHolders");
                conn.end();
                done();
              });
          })
          .catch(done);
      })
      .catch(done);
  };

  const more16MSingleNamedPlaceHolders = function(useBulk, done) {
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE more16MSingleNamedPlaceHolders(id int, id2 int, id3 int, t longtext, id4 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `more16MSingleNamedPlaceHolders` values (1, :id, 2, :id2, 3)", [
            { id: 1, id2: bigBuf },
            { id: 2, id2: "john" }
          ])
          .then(res => {
            assert.equal(res.affectedRows, 2);
            conn
              .query("select * from `more16MSingleNamedPlaceHolders`")
              .then(rows => {
                assert.deepEqual(rows, [
                  {
                    id: 1,
                    id2: 1,
                    id3: 2,
                    t: bigBuf.toString(),
                    id4: 3
                  },
                  {
                    id: 1,
                    id2: 2,
                    id3: 2,
                    t: "john",
                    id4: 3
                  }
                ]);
                conn.query("DROP TABLE more16MSingleNamedPlaceHolders");
                conn.end();
                done();
              })
              .catch(done);
          })
          .catch(done);
      })
      .catch(done);
  };

  const streamNamedPlaceHolders = (useBulk, done) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE streamNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int, id5 int) CHARSET utf8mb4"
        );
        conn
          .batch("INSERT INTO `streamNamedPlaceHolders` values (1, :id1, 2, :id3, :id7, 3)", [
            { id1: 1, id3: stream1, id4: 99, id5: 6 },
            { id1: 2, id3: stream2, id4: 98 }
          ])
          .then(res => {
            assert.equal(res.affectedRows, 2);
            conn.query("select * from `streamNamedPlaceHolders`").then(res => {
              assert.deepEqual(res, [
                {
                  id: 1,
                  id2: 1,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: null,
                  id5: 3
                },
                {
                  id: 1,
                  id2: 2,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: null,
                  id5: 3
                }
              ]);
              conn.query("DROP TABLE streamNamedPlaceHolders");
              conn.end();
              done();
            });
          })
          .catch(done);
      })
      .catch(done);
  };

  const streamErrorNamedPlaceHolders = (useBulk, done) => {
    const stream1 = fs.createReadStream(fileName);
    const stream2 = fs.createReadStream(fileName);
    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn
          .batch("INSERT INTO blabla values (1, :id1, 2, :id3, :id7, 3)", [
            { id1: 1, id3: stream1, id4: 99, id5: 6 },
            { id1: 2, id3: stream2, id4: 98 }
          ])
          .then(() => {
            done(new Error("must have thrown error !"));
          })
          .catch(err => {
            assert.isTrue(err != null);
            assert.isTrue(err.message.includes(" doesn't exist"));
            assert.isTrue(
              err.message.includes(
                "sql: INSERT INTO blabla values (1, :id1, 2, :id3, :id7, 3) - parameters:[{'id1':1,'id3':[object Object],'id4':99,'id5':6},{'id1':2,'id3':[object Object],'id4':98}]"
              )
            );
            assert.equal(err.errno, 1146);
            assert.equal(err.sqlState, "42S02");
            assert.equal(err.code, "ER_NO_SUCH_TABLE");
            conn.end();
            done();
          });
      })
      .catch(done);
  };

  const stream16MNamedPlaceHolders = function(useBulk, done) {
    const values = [];
    for (let i = 0; i < 1000000; i++) {
      if (i % 100000 === 0) values.push({ id1: i, id2: fs.createReadStream(fileName), id3: i * 2 });
      else values.push({ id1: i, id2: "abcdefghijkflmnopqrtuvwxyz🤘💪", id3: i * 2 });
    }

    base
      .createConnection({ namedPlaceholders: true, bulk: useBulk })
      .then(conn => {
        conn.query(
          "CREATE TABLE stream16MNamedPlaceHolders(id int, id2 int, id3 int, t varchar(128), id4 int, id5 int) CHARSET utf8mb4"
        );
        conn
          .batch(
            "INSERT INTO `stream16MNamedPlaceHolders` values (1, :id1, 2, :id2, :id3, 3)",
            values
          )
          .then(res => {
            assert.equal(res.affectedRows, 1000000);
            let currRow = 0;
            conn
              .queryStream("select * from `stream16MNamedPlaceHolders`")
              .on("error", err => {
                done(new Error("must not have thrown any error !"));
              })
              .on("data", row => {
                if (currRow % 10000 === 0) console.log(currRow);
                assert.deepEqual(row, {
                  id: 1,
                  id2: currRow,
                  id3: 2,
                  t: "abcdefghijkflmnopqrtuvwxyz🤘💪",
                  id4: currRow * 2,
                  id5: 3
                });
                currRow++;
              })
              .on("end", () => {
                assert.equal(1000000, currRow);
                conn.query("DROP TABLE stream16MNamedPlaceHolders");
                conn.end();
                done();
              });
          })
          .catch(done);
      })
      .catch(done);
  };

  describe("standard question mark using bulk", () => {
    const useCompression = false;
    it("simple batch", done => {
      simpleBatch(useCompression, true, done);
    });

    it("simple batch error message ", done => {
      simpleBatchErrorMsg(useCompression, true, done);
    });

    it("non rewritable batch", done => {
      nonRewritableBatch(useCompression, true, done);
    });

    it("16M+ batch with 16M max_allowed_packet", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWith16mMaxAllowedPacket(useCompression, true, done);
    });

    it("16M+ batch with max_allowed_packet set to 4M", function(done) {
      if (maxAllowedSize <= 4 * 1024 * 1024) this.skip();
      this.timeout(240000);
      bigBatchWith4mMaxAllowedPacket(useCompression, true, done);
    });

    it("16M+ error batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchError(useCompression, true, done);
    });

    it("16M+ single insert batch with no maxAllowedPacket set", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      singleBigInsertWithoutMaxAllowedPacket(useCompression, true, done);
    });

    it("batch with streams", done => {
      batchWithStream(useCompression, true, done);
    });

    it("batch error with streams", done => {
      batchErrorWithStream(useCompression, true, done);
    });

    it("16M+ batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWithStreams(useCompression, true, done);
    });

    it("16M+ error batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchErrorWithStreams(useCompression, true, done);
    });
  });

  describe("standard question mark and compress with bulk", () => {
    const useCompression = true;

    it("simple batch", done => {
      simpleBatch(useCompression, true, done);
    });

    it("simple batch error message ", done => {
      simpleBatchErrorMsg(useCompression, true, done);
    });

    it("non rewritable batch", done => {
      nonRewritableBatch(useCompression, true, done);
    });

    it("16M+ batch with 16M max_allowed_packet", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWith16mMaxAllowedPacket(useCompression, true, done);
    });

    it("16M+ batch with max_allowed_packet set to 4M", function(done) {
      if (maxAllowedSize <= 4 * 1024 * 1024) this.skip();
      this.timeout(240000);
      bigBatchWith4mMaxAllowedPacket(useCompression, true, done);
    });

    it("16M+ error batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchError(useCompression, true, done);
    });

    it("16M+ single insert batch with no maxAllowedPacket set", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      singleBigInsertWithoutMaxAllowedPacket(useCompression, true, done);
    });

    it("batch with streams", done => {
      batchWithStream(useCompression, true, done);
    });

    it("batch error with streams", done => {
      batchErrorWithStream(useCompression, true, done);
    });

    it("16M+ batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWithStreams(useCompression, true, done);
    });

    it("16M+ error batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchErrorWithStreams(useCompression, true, done);
    });
  });

  describe("standard question mark using rewrite", () => {
    const useCompression = false;
    it("simple batch", done => {
      simpleBatch(useCompression, false, done);
    });

    it("simple batch error message ", done => {
      simpleBatchErrorMsg(useCompression, false, done);
    });

    it("non rewritable batch", done => {
      nonRewritableBatch(useCompression, false, done);
    });

    it("16M+ batch with 16M max_allowed_packet", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWith16mMaxAllowedPacket(useCompression, false, done);
    });

    it("16M+ batch with max_allowed_packet set to 4M", function(done) {
      if (maxAllowedSize <= 4 * 1024 * 1024) this.skip();
      this.timeout(240000);
      bigBatchWith4mMaxAllowedPacket(useCompression, false, done);
    });

    it("16M+ error batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchError(useCompression, false, done);
    });

    it("16M+ single insert batch with no maxAllowedPacket set", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      singleBigInsertWithoutMaxAllowedPacket(useCompression, false, done);
    });

    it("batch with streams", done => {
      batchWithStream(useCompression, false, done);
    });

    it("batch error with streams", done => {
      batchErrorWithStream(useCompression, false, done);
    });

    it("16M+ batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWithStreams(useCompression, false, done);
    });

    it("16M+ error batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchErrorWithStreams(useCompression, false, done);
    });
  });

  describe("standard question mark and compress with bulk", () => {
    const useCompression = true;

    it("simple batch", done => {
      simpleBatch(useCompression, false, done);
    });

    it("simple batch error message ", done => {
      simpleBatchErrorMsg(useCompression, false, done);
    });

    it("non rewritable batch", done => {
      nonRewritableBatch(useCompression, false, done);
    });

    it("16M+ batch with 16M max_allowed_packet", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWith16mMaxAllowedPacket(useCompression, false, done);
    });

    it("16M+ batch with max_allowed_packet set to 4M", function(done) {
      if (maxAllowedSize <= 4 * 1024 * 1024) this.skip();
      this.timeout(240000);
      bigBatchWith4mMaxAllowedPacket(useCompression, false, done);
    });

    it("16M+ error batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchError(useCompression, false, done);
    });

    it("16M+ single insert batch with no maxAllowedPacket set", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      singleBigInsertWithoutMaxAllowedPacket(useCompression, false, done);
    });

    it("batch with streams", done => {
      batchWithStream(useCompression, false, done);
    });

    it("batch error with streams", done => {
      batchErrorWithStream(useCompression, false, done);
    });

    it("16M+ batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchWithStreams(useCompression, false, done);
    });

    it("16M+ error batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      bigBatchErrorWithStreams(useCompression, false, done);
    });
  });

  describe("named parameter with bulk", () => {
    it("simple batch", done => {
      simpleNamedPlaceHolders(true, done);
    });

    it("simple batch error", done => {
      simpleNamedPlaceHoldersErr(true, done);
    });

    it("non rewritable batch", done => {
      nonRewritableHoldersErr(true, done);
    });

    it("16M+ batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      more16MNamedPlaceHolders(true, done);
    });

    it("16M+ single insert batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      more16MSingleNamedPlaceHolders(true, done);
    });

    it("batch with streams", done => {
      streamNamedPlaceHolders(true, done);
    });

    it("batch error with streams", done => {
      streamErrorNamedPlaceHolders(true, done);
    });

    it("16M+ batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      stream16MNamedPlaceHolders(true, done);
    });
  });

  describe("named parameter with rewrite", () => {
    it("simple batch", done => {
      simpleNamedPlaceHolders(false, done);
    });

    it("simple batch error", done => {
      simpleNamedPlaceHoldersErr(false, done);
    });

    it("non rewritable batch", done => {
      nonRewritableHoldersErr(false, done);
    });

    it("16M+ batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      more16MNamedPlaceHolders(false, done);
    });

    it("16M+ single insert batch", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      more16MSingleNamedPlaceHolders(false, done);
    });

    it("batch with streams", done => {
      streamNamedPlaceHolders(false, done);
    });

    it("batch error with streams", done => {
      streamErrorNamedPlaceHolders(false, done);
    });

    it("16M+ batch with streams", function(done) {
      if (maxAllowedSize <= testSize) this.skip();
      this.timeout(240000);
      stream16MNamedPlaceHolders(false, done);
    });
  });
});
