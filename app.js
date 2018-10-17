const express = require('express');
var session = require('express-session');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const bodyParser = require('body-parser');
const ip = '192.168.1.202';

var attention = [];
var areas = [];

//app.set('trust proxy', 1); // trust first proxy
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json())
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
    res.render('controlArea', {
      area: area,
    })
  } else {
    res.render('pickArea');
  }
});

app.post('/addClient', function(req, res) {
  var client = req.body;
  var check = true;
  attention.forEach(item => {
    if(client.idpaciente == item.idpaciente) {
      check = false;
    }
  });
  if(check) {
    attention.push(client);
    // io.sockets.emit('hello');
    io.to('controles').emit('addClient', {attention: attention});
    res.json({body: attention});
  } else {
    res.json({err: 'El cliente ya esta en la lista de atencion'});
  }
});

app.get('/pickArea', function(req, res) {
  res.render('pickArea');
});

app.get('/panel', function(req, res) {
  res.render('panel', {attention: attention});
});

app.get('/pickAreaSelect/:area', function(req, res) {
  var area = req.params.area;
  req.session.area = area;
  res.render('controlArea', {
    attention: attention,
    area: area,
  });
});

app.get('/prioritize/:index', function(req, res) {
  var index = req.params.index;
  var priorityClient = attention[index];
  attention.splice(index, 1);
  var newAtention = [];
  newAtention.push(priorityClient);
  attention.forEach(item => {
    newAtention.push(item);
  });
  attention = newAtention;
  io.to('controles').emit('addClient', {attention: attention});
  res.json({body: attention});
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
      res.render('cordinador', {
        clients: rows,
        attention: attention,
      });
    }
  });
});

io.on('connection', function(socket) {

  socket.on('add-client', function(data){
    if (!equipments[data.username]) {
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
    console.log('control agregado');
    socket.join('controles');
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

  socket.on('disconnect', function(){
    console.log('Equipo desconectado');
  });
});

server.listen(7766, function() {
  console.log(`Servidor corriendo en http://${ip}:7766`);
});
