package main

// The monitored databases, as in ../dbmon-hypermedia/databases.js: one
// simulation for every open tab, ticking only while someone is watching.
//
// Knobs (environment), the same as the Node server's:
//   DBMON_ROWS       clusters; each is a primary and a replica row (default 50)
//   DBMON_MUTATIONS  share of rows that get a new sample per tick, 0-1 (default 0.5)
//   DBMON_FPS        ticks per second (default 5)
//
// A row that didn't change keeps its pointer, so a tick can tell what
// changed by comparing pointers.

import (
	"math"
	"math/rand/v2"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var queries = []string{
	"SELECT blah FROM something",
	"<IDLE> in transaction",
	"vacuum",
	"<IDLE>",
	"UPDATE accounts SET balance = balance - 1",
}

type Query struct {
	Elapsed   float64
	Formatted string
	ClassName string
	Text      string
}

type DB struct {
	ID         int
	Name       string
	Count      int
	CountClass string
	Top5       [5]Query
}

func envNum(name string, def float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(name), 64); err == nil && os.Getenv(name) != "" {
		return v
	}
	return def
}

var (
	rowsEnv   = int(envNum("DBMON_ROWS", 50))
	mutations = envNum("DBMON_MUTATIONS", 0.5)
	fps       = envNum("DBMON_FPS", 5)
)

func formatElapsed(v float64) string {
	str := strconv.FormatFloat(v, 'f', 2, 64)
	if v > 60 {
		minutes := int(math.Floor(v / 60))
		comps := strings.Split(strconv.FormatFloat(math.Mod(v, 60), 'f', 2, 64), ".")
		if len(comps[0]) < 2 {
			comps[0] = "0" + comps[0]
		}
		str = strconv.Itoa(minutes) + ":" + comps[0] + "." + comps[1]
	}
	return str
}

func sample(id int, name string) *DB {
	count := int(rand.Float64()*10 + 1)
	if rand.Float64() > 0.9 {
		count += 15
	}
	qs := make([]Query, count)
	for i := range qs {
		elapsed := rand.Float64() * 15
		class := "elapsed short"
		if elapsed >= 10 {
			class = "elapsed warn_long"
		} else if elapsed >= 1 {
			class = "elapsed warn"
		}
		qs[i] = Query{elapsed, formatElapsed(elapsed), class, queries[rand.IntN(len(queries))]}
	}
	sort.Slice(qs, func(a, b int) bool { return qs[a].Elapsed > qs[b].Elapsed })
	db := &DB{ID: id, Name: name, Count: count}
	copy(db.Top5[:], qs) // missing entries stay zero: empty cells
	switch {
	case count >= 20:
		db.CountClass = "label label-important"
	case count >= 10:
		db.CountClass = "label label-warning"
	default:
		db.CountClass = "label label-success"
	}
	return db
}

// sim holds the current table and calls onTick (with the new table and the
// indexes of the rows that changed) after every tick while it runs.
type sim struct {
	mu     sync.Mutex
	dbs    []*DB
	paused bool
	ticks  []int64 // when each tick happened (epoch ms, the last 5,000), for dbmon-busy.mjs
	stop   chan struct{}
	onTick func(dbs []*DB, changedAt []int)
}

func newSim() *sim {
	s := &sim{}
	for i := 0; i < rowsEnv; i++ {
		name := "cluster" + strconv.Itoa(i+1)
		s.dbs = append(s.dbs, sample(i*2, name), sample(i*2+1, name+"slave"))
	}
	return s
}

func (s *sim) current() []*DB {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dbs
}

func (s *sim) tick() {
	s.mu.Lock()
	if s.paused {
		s.mu.Unlock()
		return
	}
	s.ticks = append(s.ticks, time.Now().UnixMilli())
	if len(s.ticks) > 5000 {
		s.ticks = s.ticks[1:]
	}
	next := make([]*DB, len(s.dbs))
	var changedAt []int
	for i, db := range s.dbs {
		if rand.Float64() < mutations {
			next[i] = sample(db.ID, db.Name)
			changedAt = append(changedAt, i)
		} else {
			next[i] = db
		}
	}
	s.dbs = next
	s.mu.Unlock()
	s.onTick(next, changedAt)
}

// start and halt run the ticker; the hub calls them as the first viewer
// arrives and the last one leaves.
func (s *sim) start() {
	s.stop = make(chan struct{})
	go func(stop chan struct{}) {
		t := time.NewTicker(time.Duration(float64(time.Second) / fps))
		defer t.Stop()
		for {
			select {
			case <-t.C:
				s.tick()
			case <-stop:
				return
			}
		}
	}(s.stop)
}

func (s *sim) halt() { close(s.stop) }

func (s *sim) pause() {
	s.mu.Lock()
	s.paused = true
	s.mu.Unlock()
}

// rowText is what a row should show: its <tr>'s textContent.
func rowText(db *DB) string {
	var b strings.Builder
	b.WriteString(db.Name)
	b.WriteString(strconv.Itoa(db.Count))
	for _, q := range db.Top5 {
		b.WriteString(q.Formatted)
		b.WriteString(q.Text)
	}
	return b.String()
}
