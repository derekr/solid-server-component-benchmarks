// Datastar DBMon in Go, on the Datastar Go SDK: a port of
// ../dbmon-hypermedia/server.js that serves the same page, the same events
// and the same runner hooks, so every runner measures it unchanged.
//
// The simulation renders once per tick and hands the result to each
// connection's own goroutine, which writes it through the SDK
// (PatchElements / PatchSignals) and compresses it, so per-connection work
// spreads over every core GOMAXPROCS allows.
//
// The page's stylesheet and datastar.js are the Node port's own files
// (../dbmon-hypermedia, or DBMON_ASSETS), read at startup, so both servers
// ship the same bundle.
//
// PATCH (whole, rows, replace, signals, window), DBMON_WINDOW,
// DBMON_OVERSCAN, DBMON_SCROLL_PATCH, DBMON_WINDOW_FETCH (with DBMON_STEP
// and DBMON_AHEAD) and DBMON_BROTLI mean what they mean for the Node server. DBMON_BROTLI_IMPL picks the brotli encoder:
//
//	sdk      (default) the SDK's WithCompression(WithBrotli(...)), which is
//	         andybalholm/brotli, a pure-Go port
//	cbrotli  Google's C brotli through cgo, the library Node's zlib uses
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"

	abrotli "github.com/andybalholm/brotli"
	"github.com/google/brotli/go/cbrotli"
	"github.com/starfederation/datastar-go/datastar"
)

var (
	assets     = envStr("DBMON_ASSETS", "../dbmon-hypermedia") + "/"
	css        = string(mustRead(assets + "app.css"))
	datastarJs = mustRead(assets + "datastar.js")
)

func mustRead(path string) []byte {
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	return b
}

const rowHeight = 37 // px; window mode pins each row to it so offsets are exact

var (
	mode        = envStr("PATCH", "whole")
	window      = int(envNum("DBMON_WINDOW", 40))
	overscan    = int(envNum("DBMON_OVERSCAN", 0))
	scrollPatch = envStr("DBMON_SCROLL_PATCH", "morph")
	fetchMode   = envStr("DBMON_WINDOW_FETCH", "stream") // window mode: "stream" or "get"
	step        = int(envNum("DBMON_STEP", 20))          // GET slices: rows per grid cell
	ahead       = int(envNum("DBMON_AHEAD", 2))          // GET slices: cells preloaded ahead
	getSlices   = mode == "window" && fetchMode == "get"
	brotliImpl  = envStr("DBMON_BROTLI_IMPL", "sdk")
	brQ, brWin  = brotliSettings()
)

func envStr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

func brotliSettings() (int, int) {
	parts := strings.Split(envStr("DBMON_BROTLI", "4,22"), ",")
	q, _ := strconv.Atoi(parts[0])
	w, _ := strconv.Atoi(parts[1])
	return q, w
}

// ---- rendering: the same markup as server.js ----

var esc = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").WriteString

func writeRow(b *strings.Builder, db *DB) {
	fmt.Fprintf(b, `<tr id="db%d"><td class="dbname">`, db.ID)
	esc(b, db.Name)
	fmt.Fprintf(b, `</td><td class="query-count"><span class="%s">%d</span></td>`, db.CountClass, db.Count)
	for _, q := range db.Top5 {
		b.WriteString(`<td class="Query `)
		b.WriteString(q.ClassName)
		b.WriteString(`">`)
		esc(b, q.Formatted)
		b.WriteString(`<div class="popover left"><div class="popover-content">`)
		esc(b, q.Text)
		b.WriteString(`</div><div class="arrow"></div></div></td>`)
	}
	b.WriteString("</tr>")
}

// PATCH=signals: the same row with every value bound to a signal.
func writeSignalRow(b *strings.Builder, db *DB) {
	s := "$_d" + strconv.Itoa(db.ID)
	fmt.Fprintf(b, `<tr id="db%d"><td class="dbname">`, db.ID)
	esc(b, db.Name)
	fmt.Fprintf(b, `</td><td class="query-count"><span class="%s" data-attr:class="%s.cc" data-text="%s.n">%d</span></td>`, db.CountClass, s, s, db.Count)
	for k, q := range db.Top5 {
		fmt.Fprintf(b, `<td class="Query %s" data-attr:class="'Query ' + %s.q%d.c"><span data-text="%s.q%d.f">`, q.ClassName, s, k, s, k)
		esc(b, q.Formatted)
		fmt.Fprintf(b, `</span><div class="popover left"><div class="popover-content" data-text="%s.q%d.t">`, s, k)
		esc(b, q.Text)
		b.WriteString(`</div><div class="arrow"></div></div></td>`)
	}
	b.WriteString("</tr>")
}

func rowsHTML(dbs []*DB) string {
	var b strings.Builder
	for _, db := range dbs {
		writeRow(&b, db)
	}
	return b.String()
}

// offset < 0: not a window.
func renderTable(dbs []*DB, offset int) string {
	var b strings.Builder
	b.WriteString(`<table id="dbmon" class="table table-striped latest-data"`)
	if offset >= 0 {
		fmt.Fprintf(&b, ` style="position:absolute;top:%dpx" data-attr:style="'position:absolute;top:' + $_top + 'px'"`, offset*rowHeight)
	}
	b.WriteString("><tbody>")
	for _, db := range dbs {
		if mode == "signals" {
			writeSignalRow(&b, db)
		} else {
			writeRow(&b, db)
		}
	}
	b.WriteString("</tbody></table>")
	return b.String()
}

// A JSON string as JSON.stringify writes it: json.Marshal would escape <, >
// and & as \u00xx, which the "<IDLE>" queries are full of.
func jsonStr(b *strings.Builder, s string) {
	var j bytes.Buffer
	enc := json.NewEncoder(&j)
	enc.SetEscapeHTML(false)
	enc.Encode(s)
	b.Write(bytes.TrimSuffix(j.Bytes(), []byte("\n")))
}

// The signals for rows, as server.js's signalsOf: {"_d0":{"n":..,"cc":..,"q0":{"c","f","t"},..},..}
func signalsOf(dbs []*DB) string {
	var b strings.Builder
	b.WriteByte('{')
	for i, db := range dbs {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `"_d%d":{"n":%d,"cc":`, db.ID, db.Count)
		jsonStr(&b, db.CountClass)
		for k, q := range db.Top5 {
			fmt.Fprintf(&b, `,"q%d":{"c":`, k)
			jsonStr(&b, q.ClassName)
			b.WriteString(`,"f":`)
			jsonStr(&b, q.Formatted)
			b.WriteString(`,"t":`)
			jsonStr(&b, q.Text)
			b.WriteByte('}')
		}
		b.WriteByte('}')
	}
	b.WriteByte('}')
	return b.String()
}

// ---- one viewer: a goroutine that owns its stream (and, in window mode,
// its offset) and writes whatever the simulation or a scroll hands it ----

type msg struct {
	catchUp   bool // GET slices: a slice is on the page (cell, since)
	cell      int
	since     int
	html      string // a tick rendered once for everyone (whole, rows, replace)
	signals   string // a signals tick or snapshot
	dbs       []*DB  // window mode: a tick (with changedAt) or the snapshot
	changedAt []int
	snapshot  bool
	scrollTo  int // window mode: a scroll; -1 = not one
}

type client struct {
	id     string
	offset int
	cell   int // GET slices: the cell on the page, and the tick it was rendered at
	tick   int
	ch     chan msg
}

func rangeOf(offset, n int) (int, int) {
	return max(0, offset-overscan), min(n, offset+window+overscan)
}

func (c *client) windowEvent(sse *datastar.ServerSentEventGenerator, dbs []*DB, offset int) {
	from, to := rangeOf(offset, len(dbs))
	sse.PatchSignals([]byte(`{"_top":` + strconv.Itoa(from*rowHeight) + `}`))
	sse.PatchElements(renderTable(dbs[from:to], from))
}

// A scroll as the rows that left and entered the slice (DBMON_SCROLL_PATCH=delta).
func (c *client) scrollEvent(sse *datastar.ServerSentEventGenerator, dbs []*DB, after int) {
	a0, a1 := rangeOf(c.offset, len(dbs))
	b0, b1 := rangeOf(after, len(dbs))
	if scrollPatch != "delta" || b0 >= a1 || b1 <= a0 {
		c.windowEvent(sse, dbs, after)
		return
	}
	var gone []string
	for i := a0; i < min(b0, a1); i++ {
		gone = append(gone, "#db"+strconv.Itoa(dbs[i].ID))
	}
	for i := max(b1, a0); i < a1; i++ {
		gone = append(gone, "#db"+strconv.Itoa(dbs[i].ID))
	}
	sse.PatchSignals([]byte(`{"_top":` + strconv.Itoa(b0*rowHeight) + `}`))
	if len(gone) > 0 {
		sse.PatchElements("", datastar.WithSelector(strings.Join(gone, ", ")), datastar.WithMode(datastar.ElementPatchModeRemove))
	}
	if b0 < a0 {
		sse.PatchElements(rowsHTML(dbs[b0:a0]), datastar.WithSelector("#dbmon > tbody"), datastar.WithMode(datastar.ElementPatchModePrepend))
	}
	if b1 > a1 {
		sse.PatchElements(rowsHTML(dbs[a1:b1]), datastar.WithSelector("#dbmon > tbody"), datastar.WithMode(datastar.ElementPatchModeAppend))
	}
}

// ---- window mode, GET slices (DBMON_WINDOW_FETCH=get), as in server.js ----
// A scroll into a new cell GETs that cell's slice, and every slice patches
// in preloads for the next `ahead` cells in the scroll direction. The stream
// carries the live updates: a slice on the page posts its cell and tick to
// /view, and the client is sent its cell's rows that changed since.

type tickChange struct {
	tick      int
	changedAt []int
}

var (
	histMu  sync.Mutex
	tickNo  int
	history []tickChange // the last 64 ticks
)

func currentTick() int {
	histMu.Lock()
	defer histMu.Unlock()
	return tickNo
}

func cellOf(offset int) int { return offset / step * step }

// The rows a cell's slice holds, as the Solid server-component window cuts
// them: overscan rows above the cell, the viewport plus a cell below.
func cellRange(cell, n int) (int, int) {
	return max(0, cell-overscan), min(n, cell+window+step)
}

func sliceURL(cell int) string { return fmt.Sprintf("/slice?cell=%d&datastar=%%7B%%7D", cell) }

func preloadLinks(cell, n int) string {
	url := func(c int) string {
		if c >= 0 && c < n {
			return "'" + sliceURL(c) + "'"
		}
		return "null"
	}
	var b strings.Builder
	for k := 1; k <= ahead; k++ {
		fmt.Fprintf(&b, `<link id="slice-ahead-%d" rel="preload" as="fetch" crossorigin data-attr:href="$_dir < 0 ? %s : %s">`, k, url(cell-k*step), url(cell+k*step))
	}
	return b.String()
}

var dataAttrStyle = regexp.MustCompile(` data-attr:style="[^"]*"`)

func sliceTable(dbs []*DB, cell int) string {
	from, to := cellRange(cell, len(dbs))
	return dataAttrStyle.ReplaceAllString(renderTable(dbs[from:to], from), "")
}

func slice(cell int) string {
	tick := currentTick() // before the table: a later table is harmless, an earlier one isn't
	dbs := sim0.current()
	return sliceTable(dbs, cell) +
		fmt.Sprintf(`<div id="slice-meta" data-init="$cell = %d; $tick = %d; @post('/view', {requestCancellation: 'disabled'})"></div>`, cell, tick) +
		preloadLinks(cell, len(dbs))
}

// The rows of the client's cell that changed after `since`, or all of them
// if that tick is no longer in the history.
func (c *client) catchUp(sse *datastar.ServerSentEventGenerator, since int) {
	dbs := sim0.current()
	from, to := cellRange(c.cell, len(dbs))
	histMu.Lock()
	known := len(history) > 0 && since >= history[0].tick-1
	at := map[int]bool{}
	if known {
		for _, h := range history {
			if h.tick > since {
				for _, i := range h.changedAt {
					if i >= from && i < to {
						at[i] = true
					}
				}
			}
		}
	}
	histMu.Unlock()
	var b strings.Builder
	for i := from; i < to; i++ {
		if !known || at[i] {
			writeRow(&b, dbs[i])
		}
	}
	if b.Len() > 0 {
		sse.PatchElements(b.String())
	}
}

func (c *client) write(sse *datastar.ServerSentEventGenerator, m msg) {
	switch {
	case m.catchUp:
		c.cell = m.cell
		c.catchUp(sse, m.since)
	case m.scrollTo >= 0:
		if m.scrollTo != c.offset {
			c.scrollEvent(sse, sim0.current(), m.scrollTo)
			c.offset = m.scrollTo
		}
	case m.signals != "":
		sse.PatchSignals([]byte(m.signals))
	case m.html != "":
		if mode == "replace" {
			sse.PatchElements(m.html, datastar.WithMode(datastar.ElementPatchModeReplace))
		} else {
			sse.PatchElements(m.html)
		}
	case m.snapshot && getSlices:
		c.catchUp(sse, c.tick)
	case m.snapshot: // window mode
		c.windowEvent(sse, m.dbs, c.offset)
	case m.dbs != nil: // window tick: the changed rows in this client's slice
		from, to := rangeOf(c.offset, len(m.dbs))
		if getSlices {
			from, to = cellRange(c.cell, len(m.dbs))
		}
		var b strings.Builder
		for _, i := range m.changedAt {
			if i >= from && i < to {
				writeRow(&b, m.dbs[i])
			}
		}
		if b.Len() > 0 {
			sse.PatchElements(b.String())
		}
	}
}

// ---- the hub: render once per tick, fan out ----

var (
	sim0    = newSim()
	hubMu   sync.Mutex
	clients = map[*client]struct{}{}
	byID    = map[string]*client{}
)

func onTick(dbs []*DB, changedAt []int) {
	histMu.Lock()
	tickNo++
	history = append(history, tickChange{tickNo, changedAt})
	if len(history) > 64 {
		history = history[1:]
	}
	histMu.Unlock()
	// As server.js: a tick that changed none of the rows a style patches
	// sends nothing (window mode decides per client).
	if len(changedAt) == 0 && mode != "whole" && mode != "window" {
		return
	}
	var m msg
	m.scrollTo = -1
	switch mode {
	case "whole":
		m.html = renderTable(dbs, -1)
	case "signals":
		changed := make([]*DB, len(changedAt))
		for k, i := range changedAt {
			changed[k] = dbs[i]
		}
		m.signals = signalsOf(changed)
	case "window":
		m.dbs, m.changedAt = dbs, changedAt
	default: // rows, replace
		changed := make([]*DB, len(changedAt))
		for k, i := range changedAt {
			changed[k] = dbs[i]
		}
		m.html = rowsHTML(changed)
	}
	hubMu.Lock()
	defer hubMu.Unlock()
	for c := range clients {
		c.ch <- m
	}
}

func subscribe(c *client) func() {
	hubMu.Lock()
	defer hubMu.Unlock()
	clients[c] = struct{}{}
	if c.id != "" {
		byID[c.id] = c
	}
	// The snapshot is queued under the hub lock, so it comes before any tick.
	dbs := sim0.current()
	switch mode {
	case "signals":
		c.ch <- msg{signals: signalsOf(dbs), scrollTo: -1}
	case "window":
		c.ch <- msg{dbs: dbs, snapshot: true, scrollTo: -1}
	default:
		c.ch <- msg{html: renderTable(dbs, -1), scrollTo: -1}
	}
	if len(clients) == 1 {
		sim0.start()
		log.Println("simulation: start")
	}
	return func() {
		hubMu.Lock()
		defer hubMu.Unlock()
		delete(clients, c)
		if byID[c.id] == c {
			delete(byID, c.id)
		}
		if len(clients) == 0 {
			sim0.halt()
			log.Println("simulation: stop")
		}
	}
}

// ---- compression ----

func brotliBytes(b []byte, quality, lgwin int) []byte {
	var out strings.Builder
	if brotliImpl == "cbrotli" {
		w := cbrotli.NewWriter(&out, cbrotli.WriterOptions{Quality: quality, LGWin: lgwin})
		w.Write(b)
		w.Close()
	} else {
		w := abrotli.NewWriterOptions(&out, abrotli.WriterOptions{Quality: quality, LGWin: lgwin})
		w.Write(b)
		w.Close()
	}
	return []byte(out.String())
}

var datastarJsBr = func() []byte { // compressed once, brotli 9, as server.js does
	if brotliImpl == "cbrotli" {
		b, _ := cbrotli.Encode(datastarJs, cbrotli.WriterOptions{Quality: 9})
		return b
	}
	return brotliBytes(datastarJs, 9, 22)
}()

// cbrotliWriter compresses a stream with C brotli for DBMON_BROTLI_IMPL=cbrotli.
// The SDK flushes through http.ResponseController, which finds FlushError.
type cbrotliWriter struct {
	http.ResponseWriter
	br *cbrotli.Writer
	rc *http.ResponseController
}

func (w *cbrotliWriter) Write(b []byte) (int, error) { return w.br.Write(b) }
func (w *cbrotliWriter) FlushError() error {
	if err := w.br.Flush(); err != nil {
		return err
	}
	return w.rc.Flush()
}

var acceptsBr = regexp.MustCompile(`\bbr\b`)

// ---- the page ----

func page() string {
	tick := currentTick()
	dbs := sim0.current()
	var body, head string
	if getSlices {
		id := strconv.FormatUint(rand.Uint64(), 36)
		cell := fmt.Sprintf("Math.floor(el.scrollTop / %d) * %d", rowHeight*step, step)
		view := fmt.Sprintf("$_want !== %s && ($_dir = %s > $_want ? 1 : -1, $_want = %s, @get('/slice?cell=' + $_want, {payload: {}}))", cell, cell, cell)
		head = preloadLinks(0, len(dbs)) + "\n"
		body = fmt.Sprintf(`<style>#dbmon tr{height:%dpx}#dbmon td{white-space:nowrap}</style>
<div id="viewport" style="height:100vh;overflow-y:auto" data-signals:cid="'%s'" data-signals:cell="0" data-signals:tick="%d" data-signals:_want="0" data-signals:_dir="1"
  data-on:scroll__throttle.32ms="%s" data-on:scrollend="%s">
<div style="position:relative;height:%dpx" data-init="@get('/updates')">
%s
</div>
</div>
<div id="slice-meta"></div>`, rowHeight, id, tick, view, view, len(dbs)*rowHeight, sliceTable(dbs, 0))
	} else if mode == "window" {
		id := strconv.FormatUint(rand.Uint64(), 36)
		from, to := rangeOf(0, len(dbs))
		view := fmt.Sprintf("$offset = Math.floor(el.scrollTop / %d); @post('/view')", rowHeight)
		body = fmt.Sprintf(`<style>#dbmon tr{height:%dpx}#dbmon td{white-space:nowrap}</style>
<div id="viewport" style="height:100vh;overflow-y:auto" data-signals:offset="0" data-signals:_top="0" data-signals:cid="'%s'"
  data-on:scroll__throttle.32ms="%s" data-on:scrollend="%s">
<div style="position:relative;height:%dpx" data-init="@get('/updates')">
%s
</div>
</div>`, rowHeight, id, view, view, len(dbs)*rowHeight, renderTable(dbs[from:to], from))
	} else {
		signals := ""
		if mode == "signals" {
			var b strings.Builder
			esc(&b, signalsOf(dbs))
			signals = ` data-signals='` + b.String() + `'`
		}
		body = fmt.Sprintf("<div%s data-init=\"@get('/updates')\">\n%s\n</div>", signals, renderTable(dbs, -1))
	}
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DBMon (Datastar, Go)</title>
<style>` + css + `</style>
` + head + `<script type="module" src="/datastar.js"></script>
</head>
<body>
` + body + `
</body>
</html>`
}

// A window-mode client's signals (the `datastar` query parameter on a GET,
// the JSON body of a POST).
type view struct {
	id                 string
	offset, cell, tick int
}

func viewOf(r *http.Request) view {
	var s struct {
		Cid    any `json:"cid"`
		Offset any `json:"offset"`
		Cell   any `json:"cell"`
		Tick   any `json:"tick"`
	}
	if err := datastar.ReadSignals(r, &s); err != nil {
		return view{}
	}
	num := func(x any) int {
		switch v := x.(type) {
		case float64:
			return int(v)
		case string:
			n, _ := strconv.Atoi(v)
			return n
		}
		return 0
	}
	n := len(sim0.current())
	clamp := func(v int) int { return max(0, min(v, n-1)) }
	id := ""
	if s.Cid != nil {
		id = fmt.Sprint(s.Cid)
	}
	return view{id, clamp(num(s.Offset)), cellOf(clamp(num(s.Cell))), num(s.Tick)}
}

func main() {
	if !map[string]bool{"whole": true, "rows": true, "replace": true, "signals": true, "window": true}[mode] {
		log.Fatalf("unknown PATCH=%s", mode)
	}
	if fetchMode != "stream" && fetchMode != "get" {
		log.Fatalf("unknown DBMON_WINDOW_FETCH=%s", fetchMode)
	}
	if brotliImpl != "sdk" && brotliImpl != "cbrotli" {
		log.Fatalf("unknown DBMON_BROTLI_IMPL=%s", brotliImpl)
	}
	sim0.onTick = onTick

	mux := http.NewServeMux()
	mux.HandleFunc("/{$}", func(w http.ResponseWriter, r *http.Request) {
		html := page()
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		w.Header().Set("vary", "accept-encoding")
		if acceptsBr.MatchString(r.Header.Get("accept-encoding")) {
			w.Header().Set("content-encoding", "br")
			w.Write(brotliBytes([]byte(html), brQ, brWin))
			return
		}
		io.WriteString(w, html)
	})
	mux.HandleFunc("/datastar.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "text/javascript; charset=utf-8")
		w.Header().Set("cache-control", "max-age=3600")
		w.Header().Set("vary", "accept-encoding")
		if acceptsBr.MatchString(r.Header.Get("accept-encoding")) {
			w.Header().Set("content-encoding", "br")
			w.Write(datastarJsBr)
			return
		}
		w.Write(datastarJs)
	})
	// Runner hooks (see databases.js).
	mux.HandleFunc("/__dbmon/pause", func(w http.ResponseWriter, r *http.Request) {
		sim0.pause()
		w.WriteHeader(204)
	})
	mux.HandleFunc("/__dbmon/rows", func(w http.ResponseWriter, r *http.Request) {
		type row struct {
			ID   int    `json:"id"`
			Text string `json:"text"`
		}
		var rows []row
		for _, db := range sim0.current() {
			rows = append(rows, row{db.ID, rowText(db)})
		}
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(rows)
	})
	mux.HandleFunc("/__dbmon/ticks", func(w http.ResponseWriter, r *http.Request) {
		sim0.mu.Lock()
		ticks := append([]int64{}, sim0.ticks...)
		sim0.mu.Unlock()
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(ticks)
	})
	mux.HandleFunc("POST /view", func(w http.ResponseWriter, r *http.Request) {
		v := viewOf(r)
		hubMu.Lock()
		c := byID[v.id]
		if c != nil && getSlices {
			c.ch <- msg{catchUp: true, cell: v.cell, since: v.tick, scrollTo: -1}
		} else if c != nil {
			c.ch <- msg{scrollTo: v.offset}
		}
		hubMu.Unlock()
		w.WriteHeader(204)
	})
	// GET slices: a cell's slice as HTML for Datastar to morph in, compressed
	// on its own at the stream's settings.
	mux.HandleFunc("GET /slice", func(w http.ResponseWriter, r *http.Request) {
		if !getSlices {
			http.NotFound(w, r)
			return
		}
		cell, _ := strconv.Atoi(r.URL.Query().Get("cell"))
		html := slice(cellOf(max(0, cell)))
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		w.Header().Set("vary", "accept-encoding")
		if acceptsBr.MatchString(r.Header.Get("accept-encoding")) {
			w.Header().Set("content-encoding", "br")
			w.Write(brotliBytes([]byte(html), brQ, brWin))
			return
		}
		io.WriteString(w, html)
	})
	mux.HandleFunc("/updates", func(w http.ResponseWriter, r *http.Request) {
		c := &client{ch: make(chan msg, 4096)}
		if mode == "window" {
			v := viewOf(r)
			c.id, c.offset, c.cell, c.tick = v.id, v.offset, v.cell, v.tick
		}
		var sse *datastar.ServerSentEventGenerator
		br := acceptsBr.MatchString(r.Header.Get("accept-encoding"))
		switch {
		case br && brotliImpl == "cbrotli":
			w.Header().Set("content-encoding", "br")
			w.Header().Set("vary", "accept-encoding")
			cw := &cbrotliWriter{ResponseWriter: w, rc: http.NewResponseController(w),
				br: cbrotli.NewWriter(w, cbrotli.WriterOptions{Quality: brQ, LGWin: brWin})}
			defer cw.br.Close()
			sse = datastar.NewSSE(cw, r)
		case br:
			w.Header().Set("vary", "accept-encoding")
			sse = datastar.NewSSE(w, r, datastar.WithCompression(
				datastar.WithBrotli(datastar.WithBrotliLevel(brQ), datastar.WithBrotliLGWin(brWin))))
		default:
			sse = datastar.NewSSE(w, r)
		}
		unsubscribe := subscribe(c)
		defer unsubscribe()
		for {
			select {
			case m := <-c.ch:
				c.write(sse, m)
			case <-r.Context().Done():
				return
			}
		}
	})

	port := envStr("PORT", "3031")
	log.Printf("datastar dbmon in go (%s, brotli %s) on http://localhost:%s", mode, brotliImpl, port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
