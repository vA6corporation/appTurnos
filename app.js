const express = require('express');
var session = require('express-session');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const bodyParser = require('body-parser');
const ip = '192.168.1.202';
var attention = [];

app.set('trust proxy', 1); // trust first proxy
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true }
}));

var mysql = require('mysql');
var connection = mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : '',
  database : 'dbgrupomw'
});

connection.connect(function(err) {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }
  console.log('connected as id ' + connection.threadId);
});

app.use(express.static('public'));
app.set('view engine', 'pug');

//app.enable('view cache'); //habilitar solo en fase de produccion
app.locals.ip = ip;
app.locals.baseUrl = location => `http://${ip}:7766/${location}`;

app.get('/', function(req, res) {
  var area = req.session.area || null;
  if (area) {
    res.render('controlArea', {area: area})
  } else {
    res.render('pickArea');
  }
});

app.post('/setTurn', function(req, res) {
  var client = req.body.client;
  console.log(client);
  res.json(client);
  // var check = true;
  // attention.forEach(item => {
  //   if(client.idpaciente == item.idpaciente) {
  //     check = false;
  //   }
  // });
  // if(check) {
  //   attention.push(client);
  //   res.json({attention: attention});
  // } else {
  //   res.json({err: 'El cliente ya esta en la lista de atencion'});
  // }
});

app.get('/pickArea', function(req, res) {
  res.render('pickArea');
});

app.get('/pickAreaSelect/:area', function(req, res) {
  var area = req.params.area;
  req.session.area = area;
  res.render('controlArea', {area: area});
});

app.get('/cordinador', function(req, res) {
  // var sd = req.params.sd;
  // var ed = req.params.ed;
  req.session.area = 'cordinador';
  var year = new Date().getFullYear();
  var month = new Date().getMonth()+1;
  var day = new Date().getDate()-2;
  console.log(`${year}-${month}-${day}`);
  connection.query(`SELECT
      cmvisitas.fecha,
      paciente.idpaciente,
      paciente.nombres,
      paciente.apellidos
    FROM cmvisitas
    LEFT JOIN paciente ON cmvisitas.idpaciente = paciente.idpaciente
    WHERE fecha >= '${year}-${month}-${day}'`, (err, rows, fields) => {
    if(err) {
      console.log(err)
    } else {
      res.render('cordinador', {clients: rows});
    }
  });
});

io.on('connection', function(socket) {
  function emit(id, action){
    if (equipments[id] && equipments[id].estado && io.sockets.connected[equipments[id].socket]) {
      io.sockets.connected[equipments[id].socket].emit(action);
    }
  }

  function updateControl(){
    //io.to('controles').emit('actualizar', {tbody:tbody({lista: equipments, ip: ip}), lista:equipments})
    io.to('controles').emit('actualizar', {equipments: equipments});
  }

  function integrar(id) {
    if(equipments[id].tiempo) {
      console.log('Usuario reintegrado(tiempo establecido): '+id)
      const cTime = new Date().getTime()
      const time = equipments[id].inicio + equipments[id].tiempo
      if (cTime < time) {
        console.log('Usuario dentro del tiempo(cTime: '+cTime+' tiempo: '+time+')')
        emit(id, 'activar')
      } else {
        console.log('Usuario fuera del tiempo(cTime: '+cTime+' tiempo: '+time+')')
        emit(id, 'desactivar')
      }
    } else if(equipments[id].inicio){
      console.log('Usuario reintegrado(libre): '+id);
      emit(id, 'activar')
    } else {
      console.log('Usuario reintegrado(sin iniciar): '+id);
      emit(id, 'desactivar')
    }
    console.log(equipments);
  }

  socket.on('add-user', function(data){
    if (!equipments[data.username]){
      console.log('usuario agregado: '+data.username);
      equipments[data.username] = {
        'socket': socket.id,
        'inicio': null,
        'tiempo': null,
        'extras': null,
        'estado': true
      };
    } else {
      console.log('usuario reintegrado: '+data.username);
      equipments[data.username].socket = socket.id;
      equipments[data.username].estado = true;
    }
    integrar(data.username)
    updateControl()
  });

  socket.on('add-control', function(data){
    console.log('control agregado')
    socket.join('controles')
  });

  socket.on('add-reloj', function(data){
    console.log('reloj agregado')
    socket.join('relojes')
  });

  socket.on('activar', function(data){
    console.log("Controlando: " + data.username)
    var timeStamp = new Date().getTime()
    equipments[data.username].inicio = timeStamp
    emit(data.username, 'activar')
    updateControl();
  });

  socket.on('desactivar', function(data){
    console.log("Desactivando: " + data.username);
    emit(data.username, 'desactivar')
    updateControl();
  });

  socket.on('cobrar', function(data){
    equipments[data.username].inicio = null;
    equipments[data.username].tiempo = null;
    equipments[data.username].extras = null;
    console.log("Cobrando: " + data.username);
    if (equipments[data.username].estado) {
      emit(data.username, 'desactivar')
    } else {
      delete equipments[data.username];
    }
    updateControl();
  });

  socket.on('establecerTiempo', function(data){
    console.log('Estableciendo tiempo: '+data.username);
    equipments[data.username].tiempo = data.tiempo;
    //fucion Establecer tiempo
    var cTime = new Date().getTime();
    var timeout = data.tiempo - (cTime - equipments[data.username].inicio)
    console.log("Fijando tiempo: " + data.username);
    console.log(equipments)
    integrar(data.username)
    clearTimeout(timeouts[data.username]);
    timeouts[data.username] = setTimeout(function(){
      console.log('cortamos uso: '+data.username)
      emit(data.username, 'desactivar')
    }, timeout)
    updateControl();
    io.to('relojes').emit('actualizar');
  });

  socket.on('dejarLibre', function(data){
    console.log('dejando Libre');
    equipments[data.username].tiempo = null
    integrar(data.username)
    io.to('relojes').emit('actualizar');
    updateControl();
  });

  socket.on('establecerExtras', function(data){
    console.log('Estableciendo extras: '+data.username);
    equipments[data.username].extras = data.extras;
    console.log(equipments);
    updateControl();
  });

  socket.on('vaciarExtras', function(data){
    console.log('vaciando extras: '+data.username);
    equipments[data.username].extras = null;
    console.log(equipments);
    updateControl();
  });

  socket.on('regalarTiempo', function(data) {
    var cTime = new Date().getTime()
    var tTranscurrido = cTime - equipments[data.username].inicio
    var timeout = (equipments[data.username].tiempo + 300000) - tTranscurrido
    console.log("Fijando tiempo: " + data.username)
    emit(data.username, 'activar')
    clearTimeout(timeouts[data.username])
    timeouts[data.username] = setTimeout(function() {
      emit(data.username, 'desactivar')
    }, timeout)
  });

  socket.on('cambiarPC', function(data) {
    console.log('cambiado datos de ('+data.drag+':'+equipments[data.drag].socket+') hacia: ('+data.drop+':'+equipments[data.drop].socket+')');
    clearTimeout(timeouts[data.drag]);
    clearTimeout(timeouts[data.drop]);
    var estadoDrag = equipments[data.drag].estado
    var estadoDrop = equipments[data.drop].estado
    var socketDrag = equipments[data.drag].socket
    var socketDrop = equipments[data.drop].socket
    var tmpClient = equipments[data.drag];
    equipments[data.drag] = equipments[data.drop];
    equipments[data.drop] = tmpClient;
    equipments[data.drag].socket = socketDrag
    equipments[data.drop].socket = socketDrop
    equipments[data.drag].estado = estadoDrag
    equipments[data.drop].estado = estadoDrop
    console.log(equipments);
    if (equipments[data.drag].estado) {
      integrar(data.drag)
    } else {
      delete equipments[data.drag];
    }
    if (equipments[data.drop].estado) {
      integrar(data.drop)
    } else {
      delete equipments[data.drop];
    }
    updateControl()
  });

  socket.on('apagar', function(data){
    console.log("apagando: " + data.username);
    emit(data.username, 'apagar')
    delete equipments[data.username];
    console.log(equipments)
    updateControl();
  });

  socket.on('disconnect', function(){
    for (var key in equipments) {
      if (equipments[key].socket == socket.id) {
        if (!equipments[key].inicio) {
          console.log("Desconectando PC: "+ key);
          delete equipments[key];
        } else {
          equipments[key].estado = false
          console.log('Usuario fuera de linea: '+key);
        }
        updateControl();
      }
    }
  });
});

server.listen(7766, function() {
  console.log(`Servidor corriendo en http://${ip}:7766`);
});
