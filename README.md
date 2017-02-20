# daysidePHPServer

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) 
![PHP version](https://img.shields.io/badge/php-%3E%3D5.3.9-blue)
![Awesome](https://camo.githubusercontent.com/fef0a78bf2b1b477ba227914e3eff273d9b9713d/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f617765736f6d652533462d796573212d627269676874677265656e2e737667)
![Stable](https://img.shields.io/badge/status-stable-brightgreen)

daysidePHPServer [Dayside](https://github.com/boomyjee/dayside) plugin based php-language-server for vscode.  
Should be used with [Monaco](https://microsoft.github.io/monaco-editor/) editor only.


## Features
- code completion  
![completion](images/completion.gif)

- go to definition  
![go to definition](images/definition.gif)

## Installation
- Clone the repo with the plugin into the folder near `dayside` folder.
- Go to `server` directory and execute command `composer install`. 
- Connect the plugin to dayside as usual. See example

```html
<!-- connect dayside script -->
<script src="client/dayside.js"></script>
<link href="client/dayside.css" rel="stylesheet" type="text/css">

<!-- connect php_autocomplete script -->
<script src="<plugin_folder>/client/php_autocomplete.js"></script>

<script>
    // run dayside
    dayside({
        //...dayside options
    });
    // run php_autocomplete plugin
    dayside.plugins.php_autocomplete();({
        port: 8000, // port where backend server should start, default 8000
        wss_port: 8443 // port for websocket connection, default 8443
    });
</script>
```
Server will start automatically when you open dayside

### License

Plugin is [MIT licensed](./LICENSE).
