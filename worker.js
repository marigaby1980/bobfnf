/**
 * Build Server Worker (Node.js API for VPS Server)
 * Instructions:
 * 1. Run 'npm init -y' && 'npm install express multer child_process cors'
 * 2. Save this as worker.js and run 'node worker.js'
 * 3. Ensure 'haxelib', 'haxe', and 'zip' are installed on your VPS.
 */

const express = require('express');
const multer = require('multer');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());

const upload = multer({ dest: 'uploads/' });

app.post('/build', upload.single('modZip'), (req, res) => {
  if (!req.file) return res.status(400).send('No mod uploaded.');
  
  const jobId = Date.now().toString();
  const workDir = path.join(__dirname, 'jobs', jobId);
  fs.mkdirSync(workDir, { recursive: true });

  // Stream logs
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const log = (msg) => {
    console.log(msg);
    res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);
  };

  log('Job initialized: ' + jobId);

  // Background worker logic
  setTimeout(() => {
    try {
      log('Extracting ZIP...');
      execSync(`unzip -q ${req.file.path} -d ${workDir}/mods`);
      
      log('Cloning Base Engine (ShadowMario/FNF-PsychEngine)...');
      execSync(`git clone --depth 1 https://github.com/ShadowMario/FNF-PsychEngine ${workDir}/engine-source`);
      
      log('Injecting mods...');
      execSync(`cp -r ${workDir}/mods/* ${workDir}/engine-source/mods/ || true`);
      
      log('Installing Haxelib dependencies...');
      execSync('haxelib install hmm --quiet', { cwd: `${workDir}/engine-source` });
      execSync('haxelib run hmm install --quiet', { cwd: `${workDir}/engine-source` });

      log('Mocking sys packages for HTML5 compatibility...');
      fs.writeFileSync(`${workDir}/engine-source/source/FileSystem.hx`, 'class FileSystem { public static function absolutePath(path:String) return path; public static function exists(path:String) return false; public static function readDirectory(path:String):Array<String> return []; public static function isDirectory(path:String) return false; public static function stat(path:String) return null; public static function fullPath(path:String) return path; public static function createDirectory(path:String) {} public static function deleteFile(path:String) {} public static function deleteDirectory(path:String) {} }');
      fs.writeFileSync(`${workDir}/engine-source/source/File.hx`, 'class File { public static function getContent(path:String) return ""; public static function getBytes(path:String) return null; public static function saveContent(path:String, c:String) return; public static function saveBytes(path:String, b:Dynamic) return; public static function copy(s:String, d:String) {} }');
      fs.writeFileSync(`${workDir}/engine-source/source/Sys.hx`, 'class Sys { public static function exit(code:Int) {} public static function sleep(t:Float) {} public static function command(c:String, ?a:Array<String>) return 0; public static function args():Array<String> return []; public static function getCwd() return ""; public static function setCwd(s:String) {} public static function print(v:Dynamic) {} public static function println(v:Dynamic) {} public static function environment() return new haxe.ds.StringMap<String>(); public static function getEnv(s:String) return ""; public static function programPath() return ""; }');
      fs.writeFileSync(`${workDir}/engine-source/source/Process.hx`, 'class Process { public var stdout:Dynamic; public var stderr:Dynamic; public function new(c:String, ?a:Dynamic) { stdout = { readAll: function() return { toString: function() return "" }, readLine: function() return "" }; stderr = stdout; } public function exitCode(b:Bool=true) return 0; public function close() {} }');
      fs.writeFileSync(`${workDir}/engine-source/source/Thread.hx`, 'class Thread { public static function create(f:Void->Void) { f(); } public static function readMessage(b:Bool) return null; public static function sendMessage(m:Dynamic) {} }');
      fs.writeFileSync(`${workDir}/engine-source/source/Mutex.hx`, 'class Mutex { public function new() {} public function acquire() {} public function release() {} }');

      execSync(`sed -i -e '/discord_rpc/d' -e '/discord-rpc/d' -e '/linc_luajit/d' Project.xml || true`, { cwd: `${workDir}/engine-source` });
      execSync(`mkdir -p source/hxdiscord_rpc`, { cwd: `${workDir}/engine-source` });
      fs.writeFileSync(`${workDir}/engine-source/source/hxdiscord_rpc/Discord.hx`, 'package hxdiscord_rpc; class Discord { public static function Initialize(a:String,b:Bool,c:Dynamic){} public static function Shutdown(){} public static function RunCallbacks(){} public static function UpdatePresence(a:Dynamic){} public static function ClearPresence(){} }');
      fs.writeFileSync(`${workDir}/engine-source/source/hxdiscord_rpc/Types.hx`, 'package hxdiscord_rpc; class Types { public static inline var DISCORD_REPLY_NO=0; public static inline var DISCORD_REPLY_YES=1; public static inline var DISCORD_REPLY_IGNORE=2; }');
      fs.writeFileSync(`${workDir}/engine-source/source/hxdiscord_rpc/DiscordPresence.hx`, 'package hxdiscord_rpc; typedef DiscordPresence = Dynamic;');

      execSync(`find source -name "*.hx" -type f -exec sed -i -e 's/sys\\.FileSystem/FileSystem/g' -e 's/sys\\.io\\.File/File/g' -e 's/sys\\.io\\.Process/Process/g' -e 's/sys\\.thread\\.Thread/Thread/g' -e 's/sys\\.thread\\.Mutex/Mutex/g' -e '/import cpp\\./d' -e 's/cpp\\.ConstCharStar/String/g' -e 's/cpp\\.Callable/Dynamic/g' -e '/import llua\\./d' -e '/llua\\./d' {} +`, { cwd: `${workDir}/engine-source` });
      execSync(`find . -name "FlxSoundTray.hx" -type f -exec sed -i 's/public function new(/public function showIncrement() { show(); } public function showDecrement() { show(); }\n\n&/g' {} +`, { cwd: `${workDir}/engine-source` });

      log('Starting Lime HTML5 Compiler (With Optimizations)...');
      const build = spawn('haxelib', ['run', 'lime', 'build', 'html5', '-release', '-D', 'DISCORD_DISABLE', '-D', 'NO_PRELOAD_ALL'], {
        cwd: `${workDir}/engine-source`
      });

      build.stdout.on('data', data => log(data.toString()));
      build.stderr.on('data', data => log('ERROR: ' + data.toString()));

      build.on('close', code => {
        if (code === 0) {
          log('Standardizing output files for CDN / jsDelivr...');
          const binDir = `${workDir}/engine-source/export/release/html5/bin`;
          
          try {
            const files = fs.readdirSync(binDir);
            const mainJs = files.find(f => f.endsWith('.js') && !f.includes('howler') && !f.includes('pako') && f !== 'funkin.js');
            if (mainJs) {
               fs.renameSync(path.join(binDir, mainJs), path.join(binDir, 'funkin.js'));
               const indexPath = path.join(binDir, 'index.html');
               if (fs.existsSync(indexPath)) {
                   let content = fs.readFileSync(indexPath, 'utf-8');
                   // Replace usage of the old js string with funkin.js
                   content = content.replace(new RegExp(mainJs, 'g'), 'funkin.js');
                   fs.writeFileSync(indexPath, content);
               }
            }
          } catch(e) { log('File standardization warning: ' + e.message); }

          log('Zipping Flat Build...');
          execSync('zip -q -r ../../../../../web_export.zip *', { cwd: binDir });
          log('DONE. Download link ready.');
          res.write(`data: ${JSON.stringify({ status: 'success', downloadUrl: '/download/' + jobId })}\n\n`);
        } else {
          log('Build failed with code ' + code);
          res.write(`data: ${JSON.stringify({ status: 'error' })}\n\n`);
        }
        res.end();
      });

    } catch(err) {
      log('FATAL ERROR: ' + err.message);
      res.write(`data: ${JSON.stringify({ status: 'error' })}\n\n`);
      res.end();
    }
  }, 100);
});

app.get('/download/:jobId', (req, res) => {
  const file = path.join(__dirname, 'jobs', req.params.jobId, 'web_export.zip');
  if (fs.existsSync(file)) {
    res.download(file);
  } else {
    res.status(404).send('Not found');
  }
});

app.listen(8080, () => {
  console.log('Build worker listening on port 8080');
});
