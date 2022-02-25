const port = 8080;
const saltRounds = 10;

//requires
const jwt = require("jsonwebtoken");
const express = require("express");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const fs = require("fs");
const http = require("http");
const https = require("https");
const cookieJson = require("cookie");
const bcrypt = require("bcrypt");

const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const _ = require('lodash');


const {
  Server
} = require("socket.io");
const {
  v4: uuidv4
} = require("uuid");
const xss = require("xss");
const axios = require("axios");
const denv = require("dotenv").config();
const driver = require("./driver.js");
// const { fastmap } = require("./util.js");

//middlewaring


const res = require("express/lib/response");
const req = require("express/lib/request");
const app = express();

const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(fileUpload({
  createParentPath: true
}));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// app.use(morgan('dev'));

app.use(compression());
app.use(cookieParser());
app.use(express.static(__dirname + "/public"));
app.set("view engine", "ejs");


//endpoints
app.get("/", function (req, res) {
  Validate(
    req.cookies,
    0,
    _ => res.redirect("/profile"),
    _ => res.render("pages/index"),
    _ => res.render("pages/index")
  );
});

app.get("/profile", (req, res) => {
  Validate(
    req.cookies,
    0,
    _ => res.render("pages/profile"),
    _ => res.redirect("/sign"),
    _ => res.redirect("/")
  );
});
app.get("/admin", (req, res) => {
  Validate(
    req.cookies,
    3,
    _ => res.render("pages/admin"),
    _ => res.redirect("/sign"),
    _ => res.redirect("/")
  );
});

app.get("/sign", function (req, res) {
  Validate(
    req.cookies,
    0,
    _ => res.redirect("pages/profile"),
    _ => res.render("pages/sign"),
    _ => res.render("pages/sign")
  );
});
app.get("/games", function (req, res) {
  res.render("pages/games");
});
app.post('/upload', async (req, res) => {
  Validate(req.cookies, 0, user => {
    try {
      if (!req.files) {
        res.send({
          status: false,
          message: 'No file uploaded'
        });
      } else {
        let avatar = req.files.file;
        if (avatar.mimetype == "image/png" || avatar.mimetype == "image/jpeg") {
          if (avatar.size < 8000000) {
            avatar.mv('./public/img/' + user.username + "/pfp.png");
            res.send({
              status: true,
              message: 'File is uploaded',
            });
          } else {
            res.send({
              status: false,
              message: 'sorry, thats too big'
            });
          }
        } else {
          res.send({
            status: false,
            message: "that... doesn't look like an image"
          });
        }
      }
    } catch (err) {
      console.log(err);
      res.status(500).send(err);
    }
  }, _ => _, _ => _);
});

io.on("connection", async socket => {
  let cookies = parse(socket.request.headers.cookie);
  Validate(cookies, 0, _ => {
    ldb.addItem(socket.id, _.username);
  }, _ => {
    ldb.addItem(socket.id, null);
  }, _ => _);
  socket.on("disconnect", () => {
    ldb.delete(socket.id);
    Validate(cookies, 0, user => {
      driver.logUser(user.username, false).then(_ => {
        UpdateUserlist();
      });
    }, _ => _, _ => _);
  });
  socket.on("alive", () => {
    Validate(parse(socket.request.headers.cookie), 0, user => {
      if (!user.online) {
        driver.logUser(user.username, true).then(_ => {
          UpdateUserlist();
        });
      }
    }, _ => _, _ => _);
  });
  socket.on("feed", req => {
    switch (req.type) {
      case "render":
        Validate(
          parse(socket.request.headers.cookie),
          0,
          usr => {
            socket.emit("feed", {
              type: "render",
              username: usr.username,
              permission: usr.permission
            });
            UpdateUserlist();
          },
          _ =>
            console.log("err"),
          _ => _
        );
        break;
    }
  });
  socket.on("games", req => {
    switch (req.type) {
      case "fetch":
        driver.getGames().then(data => {
          socket.emit("games", {
            type: "fetch",
            data: data
          })
        });
        break;
    }
  });
  socket.on("chat", async req => {
    Validate(
      parse(socket.request.headers.cookie),
      0,
      usr => {
        switch (req.type) {
          case "friend":
            if (usr.username != req.username) {
              // user is the user data of the function caller
              driver
                .getUser(req.username)
                .then(async (target) => {
                  // target is the target
                  if (target != null) {
                    if (!usr.friends.includes(target.username)) {
                      let friends = usr.friends;
                      friends.push(target.username);
                      await driver.updateUser(
                        usr.username,
                        usr.username,
                        usr.permission,
                        friends
                      );
                      friends = target.friends;
                      friends.push(usr.username);
                      await driver.updateUser(
                        target.username,
                        target.username,
                        target.permission,
                        friends
                      );
                      socket.emit("chat", {
                        type: "friend",
                        result: true,
                      });
                      UpdateUserlist();
                    } else {
                      await driver.updateUser(
                        usr.username,
                        usr.username,
                        usr.permission,
                        usr.friends.filter((v) => {
                          return v != target.username;
                        })
                      );
                      await driver.updateUser(
                        target.username,
                        target.username,
                        target.permission,
                        target.friends.filter((v) => {
                          return v != usr.username;
                        })
                      );
                      socket.emit("chat", {
                        type: "friend",
                        result: true,
                      });
                      UpdateUserlist();
                    }
                  } else {
                    socket.emit("chat", {
                      type: "friend",
                      result: false,
                      error: "That user does not exist!",
                    });
                  }
                })
                .catch((e) => console.log(e));
            } else {
              socket.emit("chat", {
                type: "friend",
                result: false,
                error: "Sorry, you can't be friends with yourself :(",
              });
            }

            break;
          case "newroom":
            driver.makeRoom(uuidv4(), usr.username).then(() => {
              UpdateUserlist();
            });
            break;
          case "dm":
            let roomuuid = uuidv4();
            driver.makeRoom(roomuuid, usr.username).then(() => {
              driver.renameRoom(roomuuid, "DM with " + req.username).then(() => {
                driver.addUserToRoom(roomuuid, req.username).then(() => {
                  UpdateUserlist();
                });
              });
            });
            break;
          case "adduser":
            driver
              .addUserToRoom(req.uuid, req.username)
              .then(() => UpdateUserlist());
            break;
          case "removeuser":
            driver
              .removeUserFromRoom(req.uuid, req.username)
              .then(() => UpdateUserlist());
            break;
          case "rename":
            driver.getRoom(req.uuid).then(room => {
              if (usr.username == room.owner) {
                driver.renameRoom(req.uuid, xss(req.newname));
                UpdateUserlist();
              }
            });
            break;
          case "send":
            let sanitizedmessage = xss(req.message);
            if (sanitizedmessage != "") {
              let messageobj = {
                type: "message",
                sender: usr.username,
                message: sanitizedmessage,
                messageuuid: uuidv4(), // are you happy now?
                roomuuid: req.uuid,
              };
              UpdateMessages(req.uuid, messageobj);
              driver.addMessageToRoom(req.uuid, messageobj);
            }
            break;
          // case "roomrequest":
          //   driver.findRoom(req.uuid).then((room) => {
          //     socket.emit("chat", {
          //       type: "massmessage",
          //       messages: room.messages,
          //     });
          //   });
          //   break;
          case "leave":
            driver.removeUserFromRoom(req.uuid, usr.username).then(() => {
              UpdateUserlist();
            });
            break;
          case "changevisibility":
            driver.getRoom(req.uuid).then(room => {
              if (usr.username == room.owner) {
                driver.changeVisibility(req.uuid);
              }
            });
            break;
          case "requestpublicrooms":
            driver.getAllRooms().then(rooms => {
              socket.emit("chat", {
                type: "requestpublicrooms",
                rooms: rooms.filter(_ => { return _.public }),
              });
            })
            break;
          case "joinroom":
            driver.getRoom(req.uuid).then(room => {
              if (room.public) {
                driver.addUserToRoom(req.uuid, usr.username).then(_ => {
                  UpdateUserlist();
                })
              }
            });
            break;
          default:
            console.log("could not parse type " + res.type);
        }
      },
      _ => {
        socket.emit("chat", {
          type: req.type,
          result: false,
          error: "You are not a valid user?",
        });
      },
      _ => _
    );
  });
  socket.on("sign", req => {
    switch (req.type) {
      case "in":
        var username = req.username;
        driver.getUser(username)
          .then(usr => {
            if (usr) {
              bcrypt.compare(req.password, usr.hash, function (err, res) {
                if (res) {
                  console.log(username + " logged in");
                  socket.emit("sign", { type: "in", res: 200 });
                  Auth(usr, socket);
                } else {
                  socket.emit("sign", { type: "in", res: "nopass" });
                }
              });
            } else {
              socket.emit("sign", { type: "in", res: "nouser" });
            }
          })
          .catch(e => {
            console.log(e);
          });
        break;
      case "up":
        var username = xss(req.username);
        bcrypt.hash(req.password, saltRounds, (err, hash) => {
          driver.getUser(username).then(v => {
            if (v != null) {
              socket.emit("sign", { type: "up", res: "taken" });
            } else {
              console.log("account made");
              driver.addUser(v.username, hash);
              socket.emit("sign", { type: "up", res: 200 });
              Auth(v.username, socket);
            }
          });
        });
        break;
      case "out":
        socket.emit("sign", { type: "out" });
        break;
      default:
        console.log("fix your packets >:(");
    }
  });
  socket.on("admin", req => {
    Validate(socket.request.headers.cookie, 3, user => {
      switch (req.type) {
        case "crd":
          axios.get(process.env.HOST_IP + "/api/crd");
          break;
        default:
          console.log("fix your packets >:(");
      }
    }, _ => _, _ => socket.emit("admin", { res: "denied" }))
  });
});






httpServer.listen(port, () => {
  console.log(`HTTP Server running on port ${port}`);
});


// utilities
function Auth(user, socket) {
  let token = jwt.sign({ username: user.username }, process.env.JWT, {
    algorithm: "HS256"
  })
  console.log(user.username);
  ldb.set(socket.id, user.username);
  socket.emit("sign", { type: "auth", token });
}
function Validate(cookies, perm, success, failiure, denied) {
  var payload;
  if (cookies != null) {
    if (cookies.token != null) {
      try {
        payload = jwt.verify(cookies.token, process.env.JWT, {
          algorithm: "HS256"
        });
      } catch (e) {
        return failiure();
      }
      if (payload.username != null) {
        driver.getUser(payload.username).then(data => {
          if (data.permission >= perm) {
            return success(data);
          } else {
            return denied(data);
          }
        });
      } else {
        return failiure();
      }
    } else {
      return failiure();
    }
  } else {
    return failiure();
  }
}
function parse(data) {
  if (data != null) {
    return cookieJson.parse(data);
  }
}
function UpdateUserlist() {
  driver.getUsers().then((allusers) => {
    // get every user
    io.sockets.sockets.forEach((socket) => {
      let username = ldb.get(socket.id)?.val;

      if (username != null) {
        driver
          .getUser(username)
          .then((data) => {
            let userfriends = [];
            if (data.friends != null) {
              userfriends = data.friends;
            }
            let userlist = [];
            allusers.forEach((userentry) => {
              if (userentry.username != username) {
                userlist.push({
                  username: userentry.username,
                  online: userentry.online,
                  friend: userentry.friends.includes(username),
                });
              }
            });
            driver.getAllRooms().then((allrooms) => {
              let roomlist = [];
              allrooms.forEach((room) => {
                if (room.users.includes(data.username)) {
                  roomlist.push(room);
                }
              });
              socket.emit("userlist", {
                rooms: roomlist,
                users: userlist
              });
            });
          })
          .catch((e) => {
            console.log(e);
          });
      }
    });
  });
}
function UpdateMessages(uuid, message = null) {
  driver.findRoom(uuid).then((room) => {
    io.sockets.sockets.forEach((s) => {
      let username = ldb.get(s.id)?.val;
      if (username != null) {
        if (room != null) {
          if (room.users.includes(username)) {
            if (message != null) {
              s.emit("chat", message);
            }
          }
        } else {
          console.log("something went terribly wrong! (UpdateMessages)");
        }
      }
    });
  });
}
class fastmap {

  constructor() {
    this.umap = {};
    // ^ main map, key is a uuid, contains the key, the value, and any external data you want to tack on
    this.map = {};
    // ^ keys to uuids
    this.rmap = {};
    // ^ values to uuids
  }
  addItem(key, val) {
    let uuid = uuidv4();
    this.umap[uuid] = { key, val, data: {} };
    this.map[key] = uuid;
    this.rmap[val] = uuid;
  }
  set(key, val) {
    let uuid = this.map[key];
    this.umap[uuid].val = val;
  }
  rset(value, key) {
    let uuid = this.rmap[value];
    this.umap[uuid].key = key;
  }
  setdata(key, data) {
    let uuid = this.map[key];
    this.umap[uuid].data = data;
  }
  rsetdata(val, data) {
    let uuid = this.rmap[val];
    this.umap[uuid].data = data;
  }
  get(key) {
    let uuid = this.map[key];
    return this.umap[uuid] || null;
  }
  rget(val) {
    let uuid = this.rmap[val];
    return this.umap[uuid] || null;
  }
  delete(key) {
    this.udelete(this.map[key]);
  }
  rdelete(val) {
    this.udelete(this.rmap[val]);
  }
  udelete(uuid) {
    let o = this.umap[uuid];
    if (o != null) {
      delete this.map[o.key];
      delete this.rmap[o.val];
      delete this.umap[uuid];
    } else {
      console.log("was null!");
    }
  }
}
var ldb = new fastmap();