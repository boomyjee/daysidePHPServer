<?php

require __DIR__."/lib/Daemon.php";
Daemon::daemonize(__DIR__."/server.pid");

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use LanguageServer\Protocol\Message;
use LanguageServer\{ProtocolReader,ProtocolWriter,LanguageServer};
use Sabre\Event\{Promise,Emitter};

require __DIR__."/vendor/autoload.php";

class Reader extends Emitter implements ProtocolReader {
    function message(Message $msg) {
        $this->emit('message', [$msg]);
    }

    function close() {
        $this->emit('close');
    }
}

class Writer implements ProtocolWriter
{
    public $autocompleteServer;

    function __construct($autocompleteServer) {
        $this->autocompleteServer = $autocompleteServer;
    }

    public function write(Message $msg): Promise
    {
        $promise = new Promise();

        if (!isset($msg->body->method) || !in_array($msg->body->method,['window/logMessage',"textDocument/publishDiagnostics"])) { 
            foreach ($this->autocompleteServer->clients as $conn) {
                $conn->send((string)$msg);
            }
        }
        $promise->fulfill();
        return $promise;        
    }
}

class AutocompleteServer implements MessageComponentInterface {

    public $clients;
    public $languageServer;
    public $reader;
    public $timeoutStamp;

    const TIMEOUT = 30;

    public function __construct() {
        $this->clients = [];
        $this->timeoutStamp = time();
    }

    public function checkTimeout() {
        $time = time();
        if (count($this->clients)) $this->timeoutStamp = $time;
        if ($time - $this->timeoutStamp >= self::TIMEOUT) {
            exit(0);
        }
    }    

    public function onOpen(ConnectionInterface $from) {
        if (!$this->auth($from)) {
            $from->send('{"error":"Auth failed"}');
            $from->close();
            return;
        }

        if (!$this->languageServer) {
            $this->languageServer = new LanguageServer($this->reader = new Reader(),new Writer($this));
        }

        $this->clients[] = $from;
        echo "New connection! ({$from->resourceId})\n";
    }

    public function auth($from) {
        global $params;
        $authInclude = @$params['authInclude'] ? : __DIR__."/../../dayside/server/api.php";
        $authFunction = @$params['authFunction'] ? : array('\FileApi','remote_auth');
        
        require_once $authInclude;
        return call_user_func($authFunction,$from->WebSocket->request->getCookies());
    }    

    public function onMessage(ConnectionInterface $from, $msg) {
        //echo $msg."\n";
        $this->reader->message(Message::parse($msg));
    }

    public function onClose(ConnectionInterface $conn) {
        foreach ($this->clients as $key=>$one) {
            if ($one==$conn) {
                unset($this->clients[$key]);
                break;
            }
        }
        $conn->close();
    }

    public function onError(ConnectionInterface $conn, \Exception $e) {
        echo "An error has occurred: {$e->getMessage()}\n";
        $this->onClose($conn);
    }
}

global $params;
$params = @json_decode($_SERVER['argv'][2],true)?:array();
$port = (int)@$params['port']?:8000;

$server = IoServer::factory(
    new HttpServer(
        new WsServer(
            $autocompleteServer = new AutocompleteServer()
        )
    ),
    $port
);

$server->loop->futureTick($f = function() use ($server,&$f) {
    Sabre\Event\Loop\tick();
    $server->loop->futureTick($f);
});

$server->loop->addPeriodicTimer(1,function ($timer) use ($autocompleteServer) {
    $autocompleteServer->checkTimeout();
});

$server->run();